(function(){
  let deferredInstallPrompt=null;

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    document.dispatchEvent(new CustomEvent('pyp:pwa-install-available'));
  });

  window.PYP_PWA={
    canInstall(){
      return !!deferredInstallPrompt;
    },
    async promptInstall(){
      if(!deferredInstallPrompt) return {outcome:'unavailable'};
      deferredInstallPrompt.prompt();
      const choice=await deferredInstallPrompt.userChoice;
      deferredInstallPrompt=null;
      return choice;
    }
  };

  if(!('serviceWorker' in navigator)) return;

  window.addEventListener('load',async()=>{
    try{
      const registration=await navigator.serviceWorker.register('/service-worker.js');
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        if(!worker) return;
        worker.addEventListener('statechange',()=>{
          if(worker.state==='installed'&&navigator.serviceWorker.controller){
            worker.postMessage({type:'SKIP_WAITING'});
          }
        });
      });
    }catch{}
  });
})();
