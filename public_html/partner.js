(function(){
  'use strict';
  var P=UrbanTankerPlatform,form=document.getElementById('partner-application'),message=document.getElementById('partner-message');
  document.getElementById('partner-service-choices').innerHTML=P.services.map(function(service){return '<label class="service-choice"><input type="checkbox" name="services" value="'+service.id+'"><span>'+service.icon+' &nbsp;'+P.escapeHTML(service.name)+'</span></label>';}).join('');
  form.onsubmit=function(event){
    event.preventDefault();
    message.hidden=false;
    if(!form.reportValidity()){message.className='login-error';message.textContent='Please complete the highlighted required fields.';return;}
    var data=new FormData(form),services=data.getAll('services');
    if(!services.length){message.className='login-error';message.textContent='Choose at least one service you can provide.';document.getElementById('partner-service-choices').scrollIntoView({block:'center'});return;}
    try{
      var files=Array.from(form.querySelector('[name="documents"]').files||[]).map(function(file){return file.name;});
      P.update(function(store){
        var id=P.id('V'),active={};services.forEach(function(service){active[service]=true;});
        store.vendors.push({id:id,name:data.get('name').trim(),partnerType:data.get('partnerType'),phone:data.get('phone'),whatsapp:data.get('whatsapp')||data.get('phone'),email:data.get('email').trim(),zone:data.get('zone').trim(),address:data.get('address').trim(),capacity:data.get('capacity'),vehicleCount:Number(data.get('vehicleCount')),registration:data.get('registration').trim().toUpperCase(),experience:data.get('experience'),availability:data.get('availability'),notes:data.get('notes'),documents:files,services:active,status:'Inactive',online:false,verificationStatus:'Pending',verified:false,createdAt:P.now()});
        store.enquiries.unshift({id:P.id('ENQ'),vendorId:id,name:data.get('name'),phone:data.get('phone'),email:data.get('email'),location:data.get('zone'),services:services,status:'New',createdAt:P.now()});
        P.notify(store,'Partner application',data.get('name')+' requires review','High',id);
      });
      message.className='form-message';message.textContent='Application submitted. Our team will contact you for document and service verification.';form.reset();message.scrollIntoView({block:'center'});
    }catch(error){message.className='login-error';message.textContent='Could not save your application. Please try again.';}
  };
})();
