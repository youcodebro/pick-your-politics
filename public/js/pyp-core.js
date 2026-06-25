(function(){
  const CONFIG_URL='/.netlify/functions/public-config';
  const STATE_KEY='pyp-local-draft';
  const SCORE_ZERO={D:0,R:0,L:0,G:0,I:0};
  const ACTIVE_SESSION_STATUSES={completed:false};

  let configPromise=null;
  let clientPromise=null;
  let userPromise=null;
  const questionIdCache=new Map();

  function nowIso(){return new Date().toISOString();}
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function localDraft(){
    try{return JSON.parse(localStorage.getItem(STATE_KEY)||'{}');}
    catch{return {};}
  }
  function setLocalDraft(next){
    localStorage.setItem(STATE_KEY,JSON.stringify({...localDraft(),...next,updated_at:nowIso()}));
  }
  function uniqueAnswers(answers=[]){
    const seen=new Set();
    answers.forEach(answer=>{
      const key=answer.question_id||`${answer.module_id||'unknown'}:${answer.question_index}`;
      seen.add(key);
    });
    return seen.size;
  }
  function scoreTotal(scores={}){
    return Object.values(scores||{}).reduce((sum,value)=>sum+Math.max(0,Number(value)||0),0);
  }
  function topParty(scores={}){
    return Object.entries(scores||{}).sort((a,b)=>(Number(b[1])||0)-(Number(a[1])||0))[0]?.[0]||'D';
  }
  function shortPartyName(key){
    return ({D:'Dem',R:'Rep',L:'Lib',G:'Green',I:'Ind',democrat:'Dem',republican:'Rep',libertarian:'Lib',green:'Green',independent:'Ind'})[key]||key;
  }
  function completedModuleCount(answers=[]){
    const counts=answers.reduce((acc,answer)=>{
      if(answer.module_id) acc[answer.module_id]=(acc[answer.module_id]||0)+1;
      return acc;
    },{});
    return Object.values(counts).filter(count=>count>=8).length;
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

  async function syncLocalDraft(){
    const draft=localDraft();
    const answers=draft.answers||[];
    if(!draft.local||!answers.length) return null;
    const sb=await supabaseClient();
    const user=await currentUser();
    if(!sb||!user) return null;
    await ensureProfile();
    const {data,error}=await sb.from('sessions').insert({
      user_id:user.id,
      mode:draft.mode==='full'?'full':'daily',
      module_id:draft.current_module_id||draft.module_id||null,
      scores:draft.party_scores||SCORE_ZERO,
      questions_answered:0,
      skips_used:draft.skips_used||0,
      completed:false
    }).select('id').single();
    if(error) throw error;
    const originalAnswers=answers.map(answer=>({...answer}));
    setLocalDraft({
      session_id:data.id,
      current_session_id:data.id,
      local:false,
      answers:[],
      mode:draft.mode==='full'?'full':'daily',
      status:'in_progress'
    });
    for(const answer of originalAnswers){
      await saveAnswer({
        ...answer,
        mode:draft.mode==='full'?'full':'daily',
        party_scores:answer.party_scores||draft.party_scores||SCORE_ZERO,
        skips_used:answer.skips_used||draft.skips_used||0
      });
    }
    return data.id;
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
    if(draft.session_id&&!draft.local&&draft.mode===mode&&draft.status!=='complete'){
      return {id:draft.session_id,local:false};
    }
    const {data:existing}=await sb.from('sessions')
      .select('*')
      .eq('user_id',user.id)
      .eq('mode',mode)
      .eq('completed',ACTIVE_SESSION_STATUSES.completed)
      .order('started_at',{ascending:false})
      .limit(1)
      .maybeSingle();
    if(existing){
      setLocalDraft({
        session_id:existing.id,
        local:false,
        mode:existing.mode,
        module_id:existing.module_id||moduleId,
        current_module_id:existing.module_id||moduleId,
        party_scores:existing.scores||SCORE_ZERO,
        status:'in_progress'
      });
      return {id:existing.id,local:false};
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

  async function resolveQuestionId(payload){
    if(payload.question_id) return payload.question_id;
    const moduleId=payload.module_id;
    const orderIndex=Number(payload.question_order_index||payload.question_index+1);
    if(!moduleId||!Number.isFinite(orderIndex)) return null;
    const key=`${moduleId}:${orderIndex}`;
    if(questionIdCache.has(key)) return questionIdCache.get(key);
    const sb=await supabaseClient();
    if(!sb) return null;
    const {data,error}=await sb.from('questions')
      .select('id')
      .eq('module_id',moduleId)
      .eq('order_index',orderIndex)
      .maybeSingle();
    if(error) return null;
    const id=data?.id||null;
    questionIdCache.set(key,id);
    return id;
  }

  async function saveAnswer(payload){
    const session=await startSession({mode:payload.mode,moduleId:payload.module_id});
    const questionId=session.local?payload.question_id||null:await resolveQuestionId(payload);
    const answer={...payload,question_id:questionId,session_id:session.id,answered_at:nowIso()};
    const draft=localDraft();
    const key=questionId||`${payload.module_id}:${payload.question_index}`;
    const answers=[...(draft.answers||[]).filter(item=>(item.question_id||`${item.module_id}:${item.question_index}`)!==key),answer];
    const answeredCount=uniqueAnswers(answers);
    setLocalDraft({
      session_id:session.id,
      local:session.local,
      answers,
      current_module_id:payload.module_id,
      current_question_index:payload.next_question_index ?? payload.question_index,
      party_scores:payload.party_scores||draft.party_scores||SCORE_ZERO,
      skips_used:payload.skips_used||draft.skips_used||0,
      status:'in_progress'
    });
    if(session.local) return {local:true};
    const sb=await supabaseClient();
    const user=await currentUser();
    const row={
      user_id:user.id,
      session_id:session.id,
      question_id:questionId,
      answer:payload.answer_value,
      score_delta:payload.party_delta||{},
      answered_at:answer.answered_at
    };
    let error=null;
    if(questionId){
      const existing=await sb.from('responses')
        .select('id')
        .eq('session_id',session.id)
        .eq('question_id',questionId)
        .maybeSingle();
      if(existing.error) error=existing.error;
      else if(existing.data?.id){
        const result=await sb.from('responses').update(row).eq('id',existing.data.id);
        error=result.error;
      } else {
        const result=await sb.from('responses').insert(row);
        error=result.error;
      }
    } else {
      const result=await sb.from('responses').insert(row);
      error=result.error;
    }
    if(error) throw error;
    await sb.from('sessions').update({
      module_id:payload.module_id,
      scores:payload.party_scores||{},
      questions_answered:answeredCount,
      skips_used:payload.skips_used||0
    }).eq('id',session.id);
    return {local:false};
  }

  async function completeModule({mode='daily',moduleId,moduleTitle,partyScores,issueScores,isFinalModule=false}){
    const session=await startSession({mode,moduleId});
    const draft=localDraft();
    const completedModules=Array.from(new Set([...(draft.completed_modules||[]),moduleId]));
    setLocalDraft({
      completed_modules:completedModules,
      party_scores:partyScores||draft.party_scores||{},
      issue_scores:issueScores||draft.issue_scores||{},
      status:isFinalModule?'complete':'module_complete'
    });
    if(session.local) return {local:true};
    const sb=await supabaseClient();
    const user=await currentUser();
    const {data:profile}=await sb.from('users').select('streak_count,streak_last_date').eq('id',user.id).maybeSingle();
    const today=new Date().toISOString().slice(0,10);
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const nextStreak=profile?.streak_last_date===today
      ? (profile?.streak_count||1)
      : profile?.streak_last_date===yesterday
        ? (profile?.streak_count||0)+1
        : 1;
    await sb.from('users').update({
      streak_count:nextStreak,
      streak_last_date:today
    }).eq('id',user.id);
    await sb.from('sessions').update({
      completed:!!isFinalModule,
      module_id:moduleId,
      scores:partyScores||{},
      completed_at:isFinalModule?nowIso():null
    }).eq('id',session.id);
    return {local:false,moduleTitle};
  }

  async function completeSession({partyScores=null}={}){
    const draft=localDraft();
    setLocalDraft({
      status:'complete',
      party_scores:partyScores||draft.party_scores||{},
      completed_at:nowIso()
    });
    if(draft.local) return {local:true};
    const sb=await supabaseClient();
    const user=await currentUser();
    if(!sb||!user||!draft.session_id) return {local:!sb||!user};
    const {data:profile}=await sb.from('users').select('streak_count,streak_last_date').eq('id',user.id).maybeSingle();
    const today=new Date().toISOString().slice(0,10);
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
    const nextStreak=profile?.streak_last_date===today
      ? (profile?.streak_count||1)
      : profile?.streak_last_date===yesterday
        ? (profile?.streak_count||0)+1
        : 1;
    await sb.from('users').update({
      streak_count:nextStreak,
      streak_last_date:today
    }).eq('id',user.id);
    await sb.from('sessions').update({
      completed:true,
      scores:partyScores||draft.party_scores||{},
      completed_at:nowIso()
    }).eq('id',draft.session_id).eq('user_id',user.id);
    return {local:false};
  }

  async function loadProgress(){
    const sb=await supabaseClient();
    const user=await currentUser();
    if(!sb||!user) return localDraft();
    const {data}=await sb.from('sessions')
      .select('*')
      .eq('user_id',user.id)
      .eq('completed',false)
      .order('started_at',{ascending:false})
      .limit(1)
      .maybeSingle();
    const session=data||((await sb.from('sessions')
      .select('*')
      .eq('user_id',user.id)
      .order('started_at',{ascending:false})
      .limit(1)
      .maybeSingle()).data);
    if(!session) return localDraft();
    const responses=await sb.from('responses')
      .select('id,answer,score_delta,answered_at,question_id,questions(module_id,order_index,module_title)')
      .eq('session_id',session.id)
      .order('answered_at',{ascending:true});
    const savedAnswers=(responses.data||[]).map(row=>({
      id:row.id,
      question_id:row.question_id,
      module_id:row.questions?.module_id||session.module_id,
      module_title:row.questions?.module_title,
      question_index:Number.isInteger(row.questions?.order_index)?row.questions.order_index-1:null,
      answer_value:row.answer,
      party_delta:row.score_delta||{},
      answered_at:row.answered_at
    }));
    const last=savedAnswers[savedAnswers.length-1]||null;
    const currentQuestionIndex=last&&Number.isInteger(last.question_index)?last.question_index+1:Math.max(0,(session.questions_answered||0)-1);
    const progress={
      ...localDraft(),
      session_id:session.id,
      current_session_id:session.id,
      local:false,
      mode:session.mode,
      current_module_id:last?.module_id||session.module_id,
      current_question_index:currentQuestionIndex,
      questions_answered:session.questions_answered||savedAnswers.length,
      skips_used:session.skips_used||0,
      completed_modules:Array.from(new Set(savedAnswers.map(a=>a.module_id).filter(Boolean).filter(moduleId=>savedAnswers.filter(a=>a.module_id===moduleId).length>=8))),
      party_scores:session.scores||{},
      answers:savedAnswers,
      completed:session.completed,
      status:session.completed?'complete':'in_progress'
    };
    setLocalDraft(progress);
    return progress;
  }

  async function loadResults(){
    const progress=await loadProgress();
    const sb=await supabaseClient();
    const user=await currentUser();
    if(!sb||!user) return progress;
    const {data:sessions}=await sb.from('sessions')
      .select('*')
      .eq('user_id',user.id)
      .order('started_at',{ascending:false})
      .limit(8);
    return {
      ...progress,
      sessions:sessions||[],
      latest_session:sessions?.[0]||null
    };
  }

  async function loadDashboard(){
    const [profile,results]=await Promise.all([
      loadProfile().catch(()=>null),
      loadResults().catch(()=>localDraft())
    ]);
    const sessions=results.sessions||[];
    const latest=results.latest_session||null;
    const questionsAnswered=latest?.questions_answered||results.questions_answered||uniqueAnswers(results.answers||[]);
    const skips=latest?.skips_used||results.skips_used||0;
    const notSure=(results.answers||[]).filter(answer=>answer.answer_value==='__not_sure__').length;
    const consistency=Math.max(0,Math.min(100,Math.round(100-((skips+notSure)*4))));
    const modulesDone=completedModuleCount(results.answers||[]);
    return {
      profile,
      isPaid:hasActiveSubscription(profile),
      questionsAnswered,
      consistency,
      modulesDone,
      streakCount:profile?.streak_count||0,
      lastActivity:latest?.completed_at||latest?.started_at||null,
      scores:latest?.scores||results.party_scores||SCORE_ZERO,
      sessions,
      retakes:sessions.map(session=>{
        const scores=session.scores||{};
        const top=topParty(scores);
        const total=scoreTotal(scores)||1;
        return {
          id:session.id,
          date:session.completed_at||session.started_at,
          top,
          topLabel:shortPartyName(top),
          topPct:Math.round(Math.max(0,Number(scores[top])||0)/total*100),
          scores
        };
      })
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

  async function createShareLink(sessionId=null){
    const user=await currentUser();
    if(!user) throw new Error('Please sign in before sharing.');
    const sb=await supabaseClient();
    const {data:{session}}=await sb.auth.getSession();
    const res=await fetch('/.netlify/functions/create-share-link',{
      method:'POST',
      headers:{'content-type':'application/json',authorization:`Bearer ${session?.access_token||''}`},
      body:JSON.stringify({session_id:sessionId})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Could not create share link.');
    return data;
  }

  async function isAdmin(){
    const user=await currentUser();
    return user?.app_metadata?.role==='admin';
  }

  async function requireAdmin(){
    if(await isAdmin()) return true;
    throw new Error('Admin access required.');
  }

  async function adminList(table){
    await requireAdmin();
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    if(table==='questions') return sb.from('questions').select('*').order('module_id').order('order_index');
    if(table==='users') return sb.from('users').select('*,subscriptions(*)').order('created_at',{ascending:false}).limit(100);
    if(table==='sessions') return sb.from('sessions').select('*').order('started_at',{ascending:false}).limit(250);
    if(table==='responses') return sb.from('responses').select('id,session_id,user_id,question_id,answer,answered_at').limit(1000);
    if(table==='share_links') return sb.from('share_links').select('*').order('created_at',{ascending:false}).limit(250);
    if(table==='subscriptions') return sb.from('subscriptions').select('*').order('created_at',{ascending:false}).limit(250);
    throw new Error(`Admin table is not allowed: ${table}`);
  }
  async function adminUpsert(table,row){
    await requireAdmin();
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    if(!['questions'].includes(table)) throw new Error(`Admin upsert is not allowed for ${table}.`);
    const options=table==='questions'&&!row.id?{onConflict:'module_id,order_index'}:undefined;
    return sb.from(table).upsert(row,options).select('*').single();
  }
  async function adminDelete(table,id){
    await requireAdmin();
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    if(!['questions'].includes(table)) throw new Error(`Admin delete is not allowed for ${table}.`);
    return sb.from(table).delete().eq('id',id);
  }
  async function adminUpdateWhere(table,match,row){
    await requireAdmin();
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    if(!['questions'].includes(table)) throw new Error(`Admin update is not allowed for ${table}.`);
    let query=sb.from(table).update(row);
    Object.entries(match).forEach(([key,value])=>{query=query.eq(key,value);});
    return query;
  }
  async function adminDeleteWhere(table,match){
    await requireAdmin();
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    if(!['questions'].includes(table)) throw new Error(`Admin delete is not allowed for ${table}.`);
    let query=sb.from(table).delete();
    Object.entries(match).forEach(([key,value])=>{query=query.eq(key,value);});
    return query;
  }

  async function adminAnalytics(){
    await requireAdmin();
    const sb=await supabaseClient();
    if(!sb) throw new Error('Supabase is not configured.');
    const since=new Date(Date.now()-30*86400000).toISOString();
    const [
      sessions,
      completedSessions,
      users,
      subscribers,
      shares,
      responses,
      questions
    ]=await Promise.all([
      sb.from('sessions').select('id',{count:'exact',head:true}).gte('started_at',since),
      sb.from('sessions').select('id',{count:'exact',head:true}).gte('started_at',since).eq('completed',true),
      sb.from('users').select('id',{count:'exact',head:true}),
      sb.from('subscriptions').select('id',{count:'exact',head:true}).in('status',['active','trialing']),
      sb.from('share_links').select('id',{count:'exact',head:true}).gte('created_at',since),
      sb.from('responses').select('question_id,answer').limit(5000),
      sb.from('questions').select('id,module_id,module_title,order_index,prompt,is_active').order('module_id').order('order_index')
    ]);
    const responseRows=responses.data||[];
    const questionRows=questions.data||[];
    const dropoff=questionRows.map(question=>{
      const answered=responseRows.filter(row=>row.question_id===question.id).length;
      const skipped=responseRows.filter(row=>row.question_id===question.id&&row.answer==='__skip__').length;
      return {
        ...question,
        answered,
        skipped,
        completion_rate:sessions.count?Math.round(answered/(sessions.count||1)*100):0
      };
    });
    return {
      sessions_started:sessions.count||0,
      completed_sessions:completedSessions.count||0,
      users:userCount(users),
      subscribers:subscribers.count||0,
      shares:shares.count||0,
      completion_rate:sessions.count?Math.round((completedSessions.count||0)/(sessions.count||1)*100):0,
      share_rate:sessions.count?Math.round((shares.count||0)/(sessions.count||1)*1000)/10:0,
      dropoff
    };
  }

  function userCount(result){
    return result.count||0;
  }

  async function initAuthUI(){
    const sb=await supabaseClient();
    if(!sb) return null;
    await ensureProfile().catch(()=>null);
    await syncLocalDraft().catch(err=>console.warn('Could not sync local draft.',err));
    sb.auth.onAuthStateChange(async()=>{
      await ensureProfile().catch(()=>null);
      await syncLocalDraft().catch(err=>console.warn('Could not sync local draft.',err));
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
    syncLocalDraft,
    startSession,
    saveAnswer,
    completeModule,
    completeSession,
    loadProgress,
    loadResults,
    loadDashboard,
    loadProfile,
    hasActiveSubscription,
    createCheckoutSession,
    openCustomerPortal,
    createShareLink,
    isAdmin,
    adminList,
    adminUpsert,
    adminDelete,
    adminUpdateWhere,
    adminDeleteWhere,
    adminAnalytics,
    initAuthUI,
    localDraft,
    setLocalDraft
  };
})();
