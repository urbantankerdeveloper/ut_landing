/* Demo authentication only. Replace credential checks with a real identity provider before production. */
(function(){'use strict';
var KEY='aquaflow-demo-v1', CUSTOMER_SESSION_KEY='urban-tanker-customer-session', ADMIN_SESSION_KEY='urban-tanker-admin-session', VENDOR_SESSION_KEY='urban-tanker-vendor-session';
var Store={get:function(){return UrbanTankerPlatform.get();},update:function(fn){return UrbanTankerPlatform.update(fn);}};
function byId(id){return document.getElementById(id);}
function setAdminSession(active){if(active)sessionStorage.setItem(ADMIN_SESSION_KEY,'active');else sessionStorage.removeItem(ADMIN_SESSION_KEY);}
function setVendorSession(active,id){if(active){sessionStorage.setItem(VENDOR_SESSION_KEY,'active');sessionStorage.setItem('urban-tanker-vendor-id',id);}else{sessionStorage.removeItem(VENDOR_SESSION_KEY);sessionStorage.removeItem('urban-tanker-vendor-id');}}
function setProfile(profile){Store.update(function(d){var existing=d.customers.find(function(c){return c.email===profile.email;});if(existing){profile.id=existing.id;profile.name=existing.name||profile.name;profile.phone=existing.phone||profile.phone;existing.lastSeenAt=new Date().toISOString();}else{profile.id=UrbanTankerPlatform.id('CU');d.customers.push(Object.assign({},profile,{createdAt:new Date().toISOString()}));}d.profile=profile;});sessionStorage.setItem(CUSTOMER_SESSION_KEY,'active');}
  function initLogin() {
    var form = byId('unified-login-form');
    if (!form) { return; }
    var usernameInput = byId('login-username');
    if (!usernameInput) { return; }
    var passwordInput = byId('login-password');
    var errorBox = byId('login-error');
    var submit = byId('unified-login-submit');
    // Explicit demo accounts only. Production must verify credentials and roles on the server.
    var demoAccounts = [
      { role: 'customer', usernames: ['customer', 'customer@urbantanker.com'], passwords: ['customer123'], profile: { name: 'Demo Customer', email: 'customer@urbantanker.com', phone: '', provider: 'Demo password' } },
      { role: 'vendor', usernames: ['vendor', 'vendor@bluedrop.demo', '9876543210'], passwords: ['vendor123'], vendorId: 'v1' },
      { role: 'vendor', usernames: ['ops@clearspring.demo', '9820012345'], passwords: ['vendor123'], vendorId: 'v2' },
      { role: 'vendor', usernames: ['help@ecodrain.demo', '9867412345'], passwords: ['vendor123'], vendorId: 'v3' },
      { role: 'admin', usernames: ['admin', 'admin@urbantanker.com'], passwords: ['Maneesh@123', 'Urban@2026'] }
    ];
    function showError(message) {
      errorBox.textContent = message;
      errorBox.hidden = false;
    }
    form.addEventListener('input', function () { errorBox.hidden = true; });
    byId('toggle-login-password').addEventListener('click', function () {
      var visible = passwordInput.type === 'password';
      passwordInput.type = visible ? 'text' : 'password';
      this.textContent = visible ? 'Hide' : 'Show';
      this.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      this.setAttribute('aria-pressed', String(visible));
    });
    byId('login-google').addEventListener('click', function () {
      showError('Google sign-in is not connected yet. Use a demo username and password below.');
    });
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var username = usernameInput.value.trim().toLowerCase();
      var password = passwordInput.value;
      if (!username || !password) {
        showError('Enter your username and password.');
        (!username ? usernameInput : passwordInput).focus();
        return;
      }
      var account = demoAccounts.find(function (item) {
        return item.usernames.indexOf(username) !== -1 && item.passwords.indexOf(password) !== -1;
      });
      if (!account) { showError('Username or password not recognised. Check your details or try a demo account.'); return; }
      try {
        // A new login replaces the previous role, including stale staff sessions.
        [CUSTOMER_SESSION_KEY, VENDOR_SESSION_KEY, ADMIN_SESSION_KEY, 'urban-tanker-vendor-id', 'urban-tanker-driver-id'].forEach(function (key) { window.sessionStorage.removeItem(key); });
        Store.update(function (data) { data.profile = null; });
        if (account.role === 'customer') { setProfile(Object.assign({}, account.profile)); }
        if (account.role === 'vendor') { setVendorSession(true, account.vendorId); }
        if (account.role === 'admin') { setAdminSession(true); }
        var sessionKey = account.role === 'customer' ? CUSTOMER_SESSION_KEY : account.role === 'vendor' ? VENDOR_SESSION_KEY : ADMIN_SESSION_KEY;
        if (window.sessionStorage.getItem(sessionKey) !== 'active') { throw new Error('Session unavailable'); }
      } catch (error) {
        showError('Your browser could not save the session. Allow site storage and try again.');
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Opening your workspace…';
      var destination = account.role === 'customer' ? 'account.html' : account.role === 'vendor' ? 'vendor.html' : 'admin.html';
      var next = new URLSearchParams(window.location.search).get('next');
      var customerPages = ['yearly-contract.html', 'account-contracts.html', 'account.html', 'booking.html', 'subscriptions.html', 'tracking.html', 'account-orders.html', 'account-addresses.html', 'account-profile.html', 'account-subscriptions.html', 'account-usage.html', 'account-wallet.html', 'account-membership.html', 'account-support.html'];
      if (account.role === 'customer' && customerPages.indexOf(next) !== -1) { destination = next; }
      window.location.href = destination;
    });
  }

initLogin();
})();
