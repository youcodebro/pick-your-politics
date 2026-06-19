(function(){
  const CONFIG_URL='/.netlify/functions/public-config';
  const STATE_KEY='pyp-local-draft';
  const SCORE_ZERO={D:0,R:0,L:0,G:0,I:0};

  let configPromise=null;
  let clientPromise=null;
  let userPromise=null;

  function nowIso(){return new Date().toISOString();}
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function localDraft(){
    try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}');}
    catch{return {};}
  }
  function setLocalDraft(next){
    localStorage.setItem(STATE_KEY,JSON.stringify({...localDraft(),...next,updated_at:nowIso()}));
  }

  async function loadConfig(){
    if(configPromise) return configPromise;
    configPromise=(async()=>{
      if(window.PYP_CONFIG) return window.PYP_CONFIG;
      try{
        const res=await fetch(CONFIG_URL,{headers:{accept:'application/json'}});
        if(res.ok) return await res.json();
      }catch{}
      return {
        supabaseUrl:'',
        supabaseAnonKey:'',
        stripeMonthlyPriceId:'',
        stripeYearlyPriceId:'',
        appUrl:location.origin
      };
    })();
    return configPromise;
  }

  async function supabaseClient(){
    if(clientPromise) return clientPromise;
    clientPromise=(async()=>{
      const cfg=await loadConfig();
      if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase) return null;
      return window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
    })();
    return clientPromise;
  }

  async function currentUser(){
    if(userPromise) return userPromise;
    userPromise=(async()=>{
      const sb=await supabaseClient();
      if(!sb) return null;
      const {data}=await sb.auth.getUser();
      return data?.user||null;
    })();
    return userPromise;
  }

  async function refreshUser(){
    userPromise=null;
    return currentUser();
  }

  async function ensureProfile(){
    const sb=await supabaseClient();
    const user=await refreshUser();
    if(!sb||!user) return null;
    const meta=user.user_metadata||{};
    const profile={
      id:user.id,
      email:user.email||null,
      display_name:meta.full_name||meta.name||user.email?.split('@')[0]||'PYP voter',
      avatar_config:{seed:meta.avatar_url||user.id}
    };
    await sb.from('users').upsert(profile,{onConflict:'id'});
    return profile;
  }

  async function signInWithGoogle(){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    const redirectTo=`${location.origin}/app.html#results`;
    return sb.auth.signInWithOAuth({provider:'google',options:{redirectTo}});
  }

  async function sendMagicLink(email){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    const redirectTo=`${location.origin}/app.html#results`;
    return sb.auth.signInWithOtp({email,options:{emailRedirectTo:redirectTo}});
  }

  async function signOut(){
    const sb=await supabaseClient();
    if(sb) await sb.auth.signOut();
    userPromise=null;
  }

  async function startSession({mode='daily',moduleId=null}={}){
    mode=mode==='full'?'full':'daily';
    const sb=await supabaseClient();
    const user=await currentUser();
    const draft=localDraft();
    if(!sb||!user){
      const id=draft.session_id||crypto.randomUUID();
      setLocalDraft({session_id:id,mode,module_id:moduleId,status:'draft'});
      return {id,local:true};
    }
    await ensureProfile();
    if(draft.session_id&&!draft.local){
      return {id:draft.session_id,local:false};
    }
    const {data,error}=await sb.from('sessions').insert({
      user_id:user.id,
      mode,
      module_id:moduleId,
      scores:clone(SCORE_ZERO)
    }).select('id').single();
    if(error) throw error;
    setLocalDraft({session_id:data.id,local:false,mode,module_id:moduleId,status:'in_progress'});
    return {id:data.id,local:false};
  }

  async function saveAnswer(payload){
    const session=await startSession({mode:payload.mode,moduleId:payload.module_id});
    const answer={...payload,session_id:session.id,answered_at:nowIso()};
    const draft=localDraft();
    const answers=[...(draft.answers||[]),answer];
    setLocalDraft({
      session_id:session.id,
      local:session.local,
      answers,
      current_module_id:payload.module_id,
      current_question_index:payload.next_question_index ?? payload.question_index,
      party_scores:payload.party_scores||draft.party_scores||SCORE_ZERO,
      status:'in_progress'
    });
    if(session.local) return {local:true};
    const sb=await supabaseClient();
    const user=await currentUser();
    const {error}=await sb.from('responses').insert({
      user_id:user.id,
      session_id:session.id,
      question_id:payload.question_id||null,
      answer:payload.answer_value,
      score_delta:payload.party_delta||{},
      answered_at:answer.answered_at
    });
    if(error) throw error;
    await sb.from('sessions').update({
      module_id:payload.module_id,
      scores:payload.party_scores||{},
      questions_answered:(payload.next_question_index ?? payload.question_index)+1,
      skips_used:payload.skips_used||0
    }).eq('id',session.id);
    return {local:false};
  }

  async function completeModule({moduleId,moduleTitle,partyScores,issueScores}){
    const session=await startSession({moduleId});
    const draft=localDraft();
    setLocalDraft({
      completed_modules:Array.from(new Set([...(draft.completed_modules||[]),moduleId])),
      party_scores:partyScores||draft.party_scores||{},
      issue_scores:issueScores||draft.issue_scores||{},
      status:'module_complete'
    });
    if(session.local) return {local:true};
    const sb=await supabaseClient();
    const user=await currentUser();
    const {data:profile}=await sb.from('users').select('streak_count,streak_last_date').eq('id',user.id).maybeSingle();
    const today=new Date().toISOString().slice(0,10);
    await sb.from('users').update({
      streak_count:Math.max(1,profile?.streak_count||1),
      streak_last_date:today
    }).eq('id',user.id);
    await sb.from('sessions').update({
      completed:true,
      module_id:moduleId,
      scores:partyScores||{},
      completed_at:nowIso()
    }).eq('id',session.id);
    return {local:false,moduleTitle};
  }

  async function loadProgress(){
    const sb=await supabaseClient();
    const user=await currentUser();
    if(!sb||!user) return localDraft();
    const {data}=await sb.from('sessions')
      .select('*')
      .eq('user_id',user.id)
      .order('started_at',{ascending:false})
      .limit(1)
      .maybeSingle();
    if(!data) return localDraft();
    return {
      ...localDraft(),
      current_session_id:data.id,
      current_module_id:data.module_id,
      current_question_index:Math.max(0,(data.questions_answered||0)-1),
      party_scores:data.scores||{}
    };
  }

  async function loadProfile(){
    const sb=await supabaseClient();
    const user=await currentUser();
    if(!sb||!user) return null;
    const {data,error}=await sb.from('users').select('*,subscriptions(*)').eq('id',user.id).maybeSingle();
    if(error) throw error;
    return data;
  }

  function hasActiveSubscription(profile){
    const sub=Array.isArray(profile?.subscriptions)?profile.subscriptions[0]:profile?.subscriptions;
    return ['active','trialing'].includes(sub?.status);
  }

  async function createCheckoutSession(plan='monthly'){
    const user=await currentUser();
    if(!user) throw new Error('Please sign in before upgrading.');
    const sb=await supabaseClient();
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch('/.netlify/functions/create-checkout-session',{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${session?.access_token||''}`},
      body:JSON.stringify({plan,returnUrl:location.href})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Could not start checkout.');
    location.href=data.url;
  }

  async function openCustomerPortal(){
    const sb=await supabaseClient();
    const {data:{session}}=sb?await sb.auth.getSession():{data:{session:null}};
    const res=await fetch('/.netlify/functions/create-customer-portal-session',{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${session?.access_token||''}`},
      body:JSON.stringify({returnUrl:location.href})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Could not open billing portal.');
    location.href=data.url;
  }

  async function adminList(table){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    if(table==='questions') return sb.from(table).select('*').order('module_id').order('order_index');
    return sb.from(table).select('*');
  }
  async function adminUpsert(table,row){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    return sb.from(table).upsert(row).select('*').single();
  }
  async function adminDelete(table,id){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    return sb.from(table).delete().eq('id',id);
  }
  async function adminUpdateWhere(table,match,row){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    let query=sb.from(table).update(row);
    Object.entries(match).forEach(([key,value])=>{query=query.eq(key,value);});
    return query;
  }
  async function adminDeleteWhere(table,match){
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    let query=sb.from(table).delete();
    Object.entries(match).forEach(([key,value])=>{query=query.eq(key,value);});
    return query;
  }

  async function initAuthUI(){
    const sb=await supabaseClient();
    if(!sb) return null;
    await ensureProfile().catch(()=>null);
    sb.auth.onAuthStateChange(async()=>{
      await ensureProfile().catch(()=>null);
      userPromise=null;
      document.dispatchEvent(new CustomEvent('pyp:auth-change',{detail:{user:await currentUser()}}));
    });
    return currentUser();
  }

  window.PYP={
    loadConfig,
    supabaseClient,
    currentUser,
    refreshUser,
    ensureProfile,
    signInWithGoogle,
    sendMagicLink,
    signOut,
    startSession,
    saveAnswer,
    completeModule,
    loadProgress,
    loadProfile,
    hasActiveSubscription,
    createCheckoutSession,
    openCustomerPortal,
    adminList,
    adminUpsert,
    adminDelete,
    adminUpdateWhere,
    adminDeleteWhere,
    initAuthUI,
    localDraft,
    setLocalDraft
  };
})();
