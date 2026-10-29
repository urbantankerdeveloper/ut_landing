/* Shared Urban Tanker demo domain layer.
   Production: replace localStorage mutations with authenticated API calls. */
(function (window) {
  'use strict';

  var STORAGE_KEY = 'aquaflow-demo-v1';
  var SERVICES = [
    { id: 'water', name: 'Water Tanker', short: 'Water tanker', icon: '◒', category: 'tanker', description: 'Raw, potable, construction, commercial and industrial water delivery.', features: ['3–16 KL capacities', 'Verified tankers', 'Live order tracking'], uses: 'Homes, apartments, construction sites and industry', pricing: true },
    { id: 'sewage', name: 'Sewage Suction', short: 'Sewage pickup', icon: '⌁', category: 'tanker', description: 'Septic tank cleaning, sewage suction, drain and manhole cleaning.', features: ['Site-condition assessment', 'Specialist machinery matching', 'Photo-supported request'], uses: 'Homes, communities, commercial and industrial sites', pricing: true },
    { id: 'drinking', name: 'Drinking Water Supply', short: 'Drinking water', icon: '◉', category: 'water', description: 'Packaged drinking-water cans, bottles and scheduled bulk supply.', features: ['20 L cans and bottles', 'Quantity-based ordering', 'Recurring supply ready'], uses: 'Homes, offices, events and facilities', pricing: true },
    { id: 'cleaning', name: 'Tank & Sump Cleaning', short: 'Tank cleaning', icon: '✦', category: 'maintenance', description: 'Professional cleaning for overhead tanks, sumps and commercial storage.', features: ['Domestic and commercial', 'Reminder scheduling', 'Multi-tank requests'], uses: 'Homes, apartments and facilities', pricing: true },
    { id: 'borewell', name: 'Borewell Services', short: 'Borewell service', icon: '⌄', category: 'project', description: 'New borewell work, existing-well cleaning, inspection and maintenance.', features: ['Depth-based requirement', 'Property assessment', 'Document upload'], uses: 'Residential, agricultural, commercial and industrial property', pricing: false },
    { id: 'rmc', name: 'RMC Mix / Ready-Mix Concrete', short: 'RMC request', icon: '▦', category: 'project', description: 'Grade-specific ready-mix concrete supply with quantity, pump and delivery coordination.', features: ['Concrete-grade selection', 'Quantity in m³', 'Pump requirement'], uses: 'Building, infrastructure and civil works', pricing: false },
    { id: 'empty', name: 'Empty Tanker & Bulk Liquid Transport', short: 'Bulk liquid transport', icon: '▭', category: 'logistics', description: 'Compatible tanker transport for permitted petroleum, chemical and other bulk liquids.', features: ['Capacity and vehicle selection', 'Safety review', 'Document-based acceptance'], uses: 'Permitted commercial and industrial liquid transport', pricing: false },
    { id: 'emergency', name: 'Emergency Water & Sewage', short: 'Emergency service', icon: '!', category: 'emergency', description: 'Priority request routing for urgent water supply or sewage response.', features: ['Priority dispatch', 'Clear urgency notes', 'Live status'], uses: 'Urgent residential, commercial and site requirements', pricing: true }
  ];
  var REMOVED_SERVICE_IDS = ['ro', 'testing'];
  var REMOVED_PLAN_LABELS = ['puri' + 'fier', 'water ' + 'test'];

  var COUPONS = [
    { code: 'FIRST200', title: 'First booking benefit', type: 'flat', value: 200, services: ['water', 'sewage', 'borewell', 'rmc', 'empty', 'cleaning'], min: 1000, max: 200, validity: '31 Dec 2026', terms: 'One use per customer. Demo/configurable offer.', active: true },
    { code: 'WATER10', title: '10% off tanker water', type: 'percent', value: 10, services: ['water'], min: 1500, max: 500, validity: '31 Dec 2026', terms: 'Valid on eligible water-tanker bookings.', active: true },
    { code: 'SEWAGE300', title: 'Sewage service saving', type: 'flat', value: 300, services: ['sewage'], min: 2000, max: 300, validity: '31 Dec 2026', terms: 'One active offer per order.', active: true },
    { code: 'PROJECT5', title: 'Project request benefit', type: 'percent', value: 5, services: ['borewell', 'rmc', 'empty'], min: 5000, max: 1500, validity: '31 Dec 2026', terms: 'Applied to the final approved quotation.', active: true },
    { code: 'SUBSCRIBE10', title: 'Subscription launch offer', type: 'percent', value: 10, services: ['subscription'], min: 1000, max: 1000, validity: '31 Dec 2026', terms: 'Demo offer for eligible new plans.', active: true },
    { code: 'ALLSERVICE', title: 'Platform welcome offer', type: 'percent', value: 7, services: ['all'], min: 1200, max: 700, validity: '31 Dec 2026', terms: 'Valid on eligible services; configurable by admin.', active: true }
  ];

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function now() { return new Date().toISOString(); }
  var sequence = 0;
  function id(prefix) { sequence++; return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + sequence + '-' + Math.random().toString(36).slice(2,7).toUpperCase(); }
  function read() {
    try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (error) { return {}; }
  }
  function write(data, emit) { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); if (emit) window.dispatchEvent(new Event('ut:platform-change')); return data; }
  function mergeById(existing, defaults) {
    var result = Array.isArray(existing) ? existing.slice() : [];
    defaults.forEach(function (item) { if (!result.some(function (old) { return old.id === item.id; })) { result.push(clone(item)); } });
    return result;
  }
  function ensure() {
    var data = read();
    data.services = mergeById((data.services || []).filter(function (s) { return SERVICES.some(function (active) { return active.id === s.id; }); }), SERVICES.map(function (service) { return Object.assign({}, service, { enabled: true }); }));
    data.couponRules = mergeById(data.couponRules, COUPONS.map(function (coupon) { return Object.assign({ id: coupon.code }, coupon); }));
    data.couponRules.forEach(function (c) { c.services = c.services.filter(function (id) { return REMOVED_SERVICE_IDS.indexOf(id) < 0; }); });
    data.addresses = data.addresses || [];
    if (data.profile) data.addresses.forEach(function (a) { if (!a.ownerId) a.ownerId = data.profile.id || data.profile.email; });
    data.bookingGroups = data.bookingGroups || [];
    data.orders = (data.orders || []).filter(function (item) { return REMOVED_SERVICE_IDS.indexOf(item.serviceId) < 0; });
    data.customers = data.customers || [];
    data.subscriptions = (data.subscriptions || []).filter(function (item) {
      var label = String(item.plan || '').toLowerCase();
      return REMOVED_SERVICE_IDS.indexOf(item.serviceId) < 0 && !REMOVED_PLAN_LABELS.some(function (term) { return label.indexOf(term) > -1; });
    });
    data.contracts = data.contracts || [];
    data.enquiries = (data.enquiries || []).filter(function (item) { return REMOVED_SERVICE_IDS.indexOf(item.serviceId) < 0; });
    data.complaints = (data.complaints || []).filter(function (item) { return REMOVED_SERVICE_IDS.indexOf(item.serviceId) < 0; });
    data.notifications = data.notifications || [];
    data.documents = data.documents || [];
    data.vendors = mergeById(data.vendors, [
      { id: 'v1', name: 'BlueDrop Tankers', phone: '9876543210', email: 'vendor@bluedrop.demo', zone: 'Central zone', verificationStatus: 'Approved', status: 'Active', online: true, verified: true, services: { water: true, sewage: true, borewell: false, rmc: true, empty: false, cleaning: false }, rejectionReason: '' },
      { id: 'v2', name: 'ClearSpring Services', phone: '9820012345', email: 'ops@clearspring.demo', zone: 'North zone', verificationStatus: 'Under Review', status: 'Inactive', online: false, verified: false, services: { water: true, sewage: false, borewell: true, rmc: false, empty: false }, rejectionReason: '' },
      { id: 'v3', name: 'EcoDrain Solutions', phone: '9867412345', email: 'help@ecodrain.demo', zone: 'South zone', verificationStatus: 'Approved', status: 'Active', online: true, verified: true, services: { water: false, sewage: true, borewell: false, rmc: false, empty: true }, rejectionReason: '' }
    ]);
    data.vendors.forEach(function (vendor) {
      REMOVED_SERVICE_IDS.forEach(function (id) { if (vendor.services) delete vendor.services[id]; });
      if (!vendor.verificationStatus) vendor.verificationStatus = vendor.online ? 'Approved' : 'Pending';
      if (!vendor.status) vendor.status = vendor.online ? 'Active' : 'Inactive';
      if (vendor.verified === undefined) vendor.verified = vendor.verificationStatus === 'Approved';
      if (!vendor.services) vendor.services = vendor.id === 'v3' ? { water:false, sewage:true, empty:true } : { water:true, sewage:vendor.id === 'v1', rmc:vendor.id === 'v1' };
    });
    data.vehicles = mergeById(data.vehicles, [
      { id: 'veh1', vendorId: 'v1', number: 'TN 09 AB 1234', type: 'Water Tanker', serviceId: 'water', capacity: '6 KL', photo: '', rc: 'RC verified', insurance: 'Valid to 31 Mar 2027', permit: 'State permit', fitness: 'Valid', pollution: 'Valid', driverId: 'drv1', active: true, verificationStatus: 'Verified' },
      { id: 'veh2', vendorId: 'v1', number: 'TN 09 UT 6621', type: 'RMC Mixer Truck', serviceId: 'rmc', capacity: '7 m³', photo: '', rc: 'RC uploaded', insurance: 'Valid to 10 Feb 2027', permit: 'Goods permit', fitness: 'Valid', pollution: 'Valid', driverId: 'drv2', active: true, verificationStatus: 'Pending' },
      { id: 'veh3', vendorId: 'v3', number: 'TN 01 QX 4410', type: 'Suction Tanker', serviceId: 'sewage', capacity: '6 KL', photo: '', rc: 'RC verified', insurance: 'Valid to 18 Jun 2027', permit: 'State permit', fitness: 'Valid', pollution: 'Valid', driverId: 'drv3', active: true, verificationStatus: 'Verified' }
    ]);
    data.drivers = mergeById(data.drivers, [
      { id: 'drv1', vendorId: 'v1', name: 'Ravi Kumar', mobile: '9876543210', whatsapp: '9876543210', licence: 'TN09 20140012345', licenceValidity: '2029-05-31', idDocument: 'Aadhaar verified', vehicleId: 'veh1', serviceId: 'water', active: true, verificationStatus: 'Verified', photo: '' },
      { id: 'drv2', vendorId: 'v1', name: 'Karthik S', mobile: '9000011122', whatsapp: '9000011122', licence: 'TN09 20170033445', licenceValidity: '2028-11-12', idDocument: 'ID uploaded', vehicleId: 'veh2', serviceId: 'rmc', active: true, verificationStatus: 'Pending', photo: '' },
      { id: 'drv3', vendorId: 'v3', name: 'Manish Das', mobile: '9867412345', whatsapp: '9867412345', licence: 'TN01 20130090876', licenceValidity: '2027-08-20', idDocument: 'Aadhaar verified', vehicleId: 'veh3', serviceId: 'sewage', active: true, verificationStatus: 'Verified', photo: '' }
    ]);
    if (!data.complaints.length) data.complaints.push({ id: 'CMP-DEMO-01', vendorId: 'v1', orderId: 'AF-260901', customer: 'Aarav Mehta', serviceId: 'water', category: 'Arrival delay', description: 'Demo complaint for workflow review.', evidence: '', priority: 'Medium', status: 'Under Review', adminNotes: 'Awaiting vendor response.', vendorResponse: '', resolution: '', createdAt: now() });
    if (!data.notifications.length) data.notifications.push({ id: 'NTF-DEMO-01', type: 'Vendor verification request', title: 'ClearSpring Services requires review', priority: 'High', status: 'Unread', createdAt: now(), demo: true });
    return write(data, false);
  }
  function update(mutator) { var data = ensure(); mutator(data); return write(data, true); }
  function service(idValue) { return SERVICES.filter(function (item) { return item.id === idValue; })[0]; }
  function notify(data, type, title, priority, linkId) {
    data.notifications = data.notifications || [];
    data.notifications.unshift({ id: id('NTF'), type: type, title: title, priority: priority || 'Normal', status: 'Unread', linkId: linkId || '', createdAt: now() });
  }
  function eligible(vendorId, serviceId) {
    var data = ensure();
    var vendor = data.vendors.find(function (item) { return item.id === vendorId; });
    if (!service(serviceId) || data.services.some(function (s) { return s.id === serviceId && s.enabled === false; })) return false;
    if (!vendor || vendor.status !== 'Active' || vendor.verificationStatus !== 'Approved' || !vendor.services || !vendor.services[serviceId]) return false;
    return data.vehicles.some(function (vehicle) {
      if (vehicle.vendorId !== vendorId || vehicle.serviceId !== serviceId || !vehicle.active || vehicle.verificationStatus !== 'Verified') return false;
      return data.drivers.some(function (driver) { return driver.id === vehicle.driverId && driver.vendorId === vendorId && driver.vehicleId === vehicle.id && driver.serviceId === serviceId && driver.active && driver.verificationStatus === 'Verified'; });
    });
  }
  function matchingVendors(serviceId) { return ensure().vendors.filter(function (vendor) { return eligible(vendor.id, serviceId); }); }
  function applyCoupon(code, serviceId, amount) {
    var rule = ensure().couponRules.find(function (item) { return item.code === String(code || '').trim().toUpperCase() && item.active; });
    if (!rule) return { valid: false, message: 'Coupon not found or inactive.', discount: 0 };
    if (rule.services.indexOf('all') < 0 && rule.services.indexOf(serviceId) < 0) return { valid: false, message: 'This coupon is not applicable to the selected service.', discount: 0 };
    if (Number(amount || 0) < Number(rule.min || 0)) return { valid: false, message: 'Minimum order value is ₹' + Number(rule.min).toLocaleString('en-IN') + '.', discount: 0 };
    var discount = rule.type === 'percent' ? Math.round(Number(amount) * Number(rule.value) / 100) : Number(rule.value);
    discount = Math.min(discount, Number(rule.max || discount), Number(amount));
    return { valid: true, message: rule.code + ' applied.', discount: discount, rule: rule };
  }
  function createBooking(payload) {
    if (!service(payload.serviceId)) throw new Error('This service is not available.');
    var created;
    update(function (data) {
      var matches = data.vendors.filter(function (vendor) { return eligible(vendor.id, payload.serviceId); });
      created = Object.assign({ id: id('UT'), customerName: 'Guest customer', customerPhone: '', serviceId: payload.serviceId, service: (service(payload.serviceId) || {}).name || payload.serviceId, capacity: payload.capacity || payload.quantity || payload.depth || 'To be confirmed', amount: 0, discount: 0, couponCode: '', status: 'PENDING_VENDOR', vendorId: matches[0] ? matches[0].id : '', createdAt: now(), updatedAt: now(), demo: true }, payload);
      data.orders.unshift(created);
      notify(data, 'New booking', created.id + ' · ' + created.service, payload.emergency ? 'Critical' : 'High', created.id);
    });
    return created;
  }
  function setStatus(kind, entityId, status, reason) {
    var map = { vendor: 'vendors', vehicle: 'vehicles', driver: 'drivers' };
    return update(function (data) {
      var item = (data[map[kind]] || []).find(function (entity) { return entity.id === entityId; });
      if (!item) return;
      if (kind === 'vendor') { item.verificationStatus = status; item.verified = status === 'Approved'; item.status = status === 'Approved' ? 'Active' : status === 'Suspended' ? 'Suspended' : 'Inactive'; item.online = item.status === 'Active'; }
      else item.verificationStatus = status;
      item.rejectionReason = reason || '';
      notify(data, kind + ' verification', (item.name || item.number || item.id) + ' · ' + status, status === 'Rejected' || status === 'Suspended' ? 'High' : 'Normal', entityId);
    });
  }
  function money(value) { return '₹' + Math.round(Number(value) || 0).toLocaleString('en-IN'); }
  function escapeHTML(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }


  function addressOwner() { var p = ensure().profile; return p ? (p.id || p.email) : 'guest'; }
  function addresses() { var owner = addressOwner(); return ensure().addresses.filter(function (a) { return (a.ownerId || 'guest') === owner; }); }
  function saveAddress(value) {
    if (!String(value.address || '').trim() || !String(value.label || '').trim()) throw new Error('Enter an address and a label.');
    var owner = addressOwner(), created = Object.assign({}, value, { id: id('ADR'), ownerId: owner, address: value.address.trim(), label: value.label.trim() });
    update(function (d) { d.addresses.push(created); });
    return created;
  }
  function createGroup(contact, items) {
    if (!items.length || items.some(function (item) { return !service(item.serviceId) || ensure().services.some(function(s){return s.id===item.serviceId&&s.enabled===false;}) || !Number.isInteger(item.trips) || item.trips < 1 || item.trips > 50; })) throw new Error('Check service items and tanker quantities.');
    var group = { id: id('BKG'), customerId: (ensure().profile || {}).id || '', customerEmail: contact.customerEmail || '', customerPhone: contact.customerPhone, customerName: contact.customerName, address: contact.address, schedule: contact.schedule, orderIds: [], createdAt: now() };
    update(function (d) {
      items.forEach(function (item) {
        var fulfilment = item.serviceId === 'emergency' ? (/sewage/i.test(item.serviceType) ? 'sewage' : 'water') : item.serviceId;
        var match = d.vendors.find(function (v) { return eligible(v.id, fulfilment); });
        var order = Object.assign({}, contact, item, { id: id('UT'), groupId: group.id, fulfillmentServiceId: fulfilment, customerId: group.customerId, service: service(item.serviceId).name, deliveryOtp: String(Math.floor(100000 + Math.random() * 900000)), status: 'PENDING_VENDOR', vendorId: match ? match.id : '', createdAt: now(), updatedAt: now(), demo: true, paymentStatus: item.estimatePending ? 'Estimate required' : 'Pending' });
        d.orders.unshift(order); group.orderIds.push(order.id);
        if (match) { notify(d, 'Service assignment', group.id + ' · ' + order.service, 'High', order.id); d.notifications[0].vendorId = match.id; }
      });
      d.bookingGroups.unshift(group);
      notify(d, 'New booking', group.id + ' · ' + items.length + ' service items', 'High', group.id);
    });
    return group;
  }

  window.UrbanTankerPlatform = { addresses: addresses, saveAddress: saveAddress, addressOwner: addressOwner, createGroup: createGroup, STORAGE_KEY: STORAGE_KEY, services: SERVICES, coupons: COUPONS, get: ensure, update: update, service: service, notify: notify, eligible: eligible, matchingVendors: matchingVendors, applyCoupon: applyCoupon, createBooking: createBooking, setStatus: setStatus, money: money, escapeHTML: escapeHTML, id: id, now: now };
  ensure();
}(window));
