var reference=new URLSearchParams(location.search).get('id')||sessionStorage.getItem('ut-last-booking');if(reference)location.replace('booking-details.html?id='+encodeURIComponent(reference));
