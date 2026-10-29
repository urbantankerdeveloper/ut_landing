/* Demo account session. Production access control belongs on the server. */
(function () {
  'use strict';
  var profile;
  try {
    profile = JSON.parse(localStorage.getItem('aquaflow-demo-v1') || '{}').profile;
    if (sessionStorage.getItem('urban-tanker-customer-session') !== 'active' || !profile) {
      window.location.replace('login.html?next=account.html');
      return;
    }
  } catch (error) {
    window.location.replace('login.html?next=account.html');
    return;
  }
  var name = document.querySelector('[data-customer-name]');
  if (name) { name.textContent = 'Hi, ' + String(profile.name || 'Customer').split(' ')[0]; }
  var logout = document.querySelector('[data-customer-logout]');
  if (logout) {
    logout.addEventListener('click', function () {
      sessionStorage.removeItem('urban-tanker-customer-session');
      var data = JSON.parse(localStorage.getItem('aquaflow-demo-v1') || '{}');
      data.profile = null;
      localStorage.setItem('aquaflow-demo-v1', JSON.stringify(data));
      window.location.href = 'login.html';
    });
  }
}());
