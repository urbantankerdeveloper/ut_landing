import { useRef, useState, type FormEvent } from 'react'
import { ArrowRight, Check, MessageCircle, MessageSquare, Plus, Trash2 } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { useAppNavigation } from '../routing/useAppNavigation'
import { useAuthStore } from '../stores/authStore'
import { partnerApi, type PartnerDocument, type PartnerVehicleInput } from '../api/partner'
import { useFileUpload } from '../hooks/useFrontendFeatures'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { partnerContent as p } from '../content/partner'
import { notifyError, notifySuccess } from '../utils/notify'
import { PhoneVerifyDialog } from '../components/PhoneVerifyDialog'
import { authApi } from '../api/auth'

export default function PartnerApplicationScreen() {
  const { navigate, openWorkspace } = useAppNavigation()
  const setPartnerFormDirty = useNavigationStore((state) => state.setPartnerFormDirty)
  const user = useAuthStore((state) => state.user)
  const setAuthUser = useAuthStore((state) => state.setUser)
  const fileUpload = useFileUpload()
  const featureFlags = useFeatureFlags()
  const otpEnabled = featureFlags.data?.partner_application_otp_enabled === true
  const openVendorWorkspace = () => user ? openWorkspace(user.role) : navigate('login')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [phone, setPhone] = useState(user?.phone?.replace(/\D/g, '').slice(-10) ?? '')
  const [otp, setOtp] = useState('')
  const [phoneChallengeId, setPhoneChallengeId] = useState<string | null>(null)
  const [phoneOtpChannel, setPhoneOtpChannel] = useState<'whatsapp' | 'sms' | null>(null)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [phoneVerifyDialogOpen, setPhoneVerifyDialogOpen] = useState(false)
  const [otpBusy, setOtpBusy] = useState(false)
  const phoneVerifyDialogEnabled = import.meta.env.VITE_PHONE_VERIFY_DIALOG_ENABLED === 'true'
  const [vehicles, setVehicles] = useState([{ id: 1 }])
  const nextVehicleId = useRef(2)
  const toggleService = (service: string) => setSelectedServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service])
  const addVehicle = () => {
    setVehicles((current) => current.length >= 250 ? current : [...current, { id: nextVehicleId.current++ }])
    setPartnerFormDirty(true)
  }
  const removeVehicle = (id: number) => {
    setVehicles((current) => current.length <= 1 ? current : current.filter((vehicle) => vehicle.id !== id))
    setPartnerFormDirty(true)
  }

  async function requestPhoneOtp() {
    setOtpBusy(true)
    try {
      const result = await partnerApi.requestPhoneOtp(phone)
      setPhoneChallengeId(result.challengeId)
      setPhoneOtpChannel(result.channel)
      setOtp('')
      notifySuccess(`We sent a code via ${result.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 ${phone}.`)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : p.messages.otpSendFailed)
    } finally {
      setOtpBusy(false)
    }
  }

  async function verifyPhoneOtp() {
    if (!phoneChallengeId) return
    setOtpBusy(true)
    try {
      await partnerApi.verifyPhoneOtp({ challengeId: phoneChallengeId, phone, otp })
      setPhoneVerified(true)
      notifySuccess(p.verification.verified)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : p.messages.otpVerifyFailed)
    } finally {
      setOtpBusy(false)
    }
  }

  function changePhone() {
    setPhoneVerified(false)
    setPhoneChallengeId(null)
    setPhoneOtpChannel(null)
    setOtp('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!featureFlags.isSuccess) return
    if (otpEnabled && user && phoneVerifyDialogEnabled && (!phoneVerified || !phoneChallengeId)) {
      setPhoneVerifyDialogOpen(true)
      return
    }
    if (otpEnabled && (!phoneVerified || !phoneChallengeId)) {
      notifyError(p.messages.otpVerifyFailed)
      return
    }
    if (selectedServices.length === 0) { notifyError(p.messages.chooseService); return }
    const data = new FormData(event.currentTarget)
    const vehicleForms = vehicles.map((_, index) => ({
      registrationNumber: String(data.get(`vehicleRegistration-${index}`) ?? ''),
      vehicleType: String(data.get(`vehicleType-${index}`) ?? ''),
      serviceCategory: String(data.get(`vehicleService-${index}`) ?? ''),
      capacity: String(data.get(`vehicleCapacity-${index}`) ?? ''),
      availability: String(data.get(`vehicleAvailability-${index}`) ?? ''),
      files: data.getAll(`vehicleDocuments-${index}`).filter((file): file is File => file instanceof File && file.name.length > 0),
    }))
    const files = vehicleForms.flatMap((vehicle) => vehicle.files)
    if (files.length > 10) { notifyError(p.messages.tooManyDocuments); return }
    try {
      const applicationId = crypto.randomUUID()
      const documents: PartnerDocument[] = []
      const submittedVehicles: PartnerVehicleInput[] = []
      for (const vehicle of vehicleForms) {
        const vehicleDocuments: PartnerDocument[] = []
        for (const file of vehicle.files) {
          let document: PartnerDocument
          if (otpEnabled) {
            if (!phoneChallengeId) throw new Error(p.messages.otpVerifyFailed)
            document = await partnerApi.uploadDocument(file, applicationId, phoneChallengeId, phone)
          } else {
            const signed = await fileUpload.upload(file, 'partner-applications', applicationId)
            document = { path: signed.path, type: file.type || 'application/octet-stream' }
          }
          documents.push(document)
          vehicleDocuments.push(document)
        }
        submittedVehicles.push({
          registrationNumber: vehicle.registrationNumber,
          vehicleType: vehicle.vehicleType,
          serviceCategory: vehicle.serviceCategory,
          capacity: vehicle.capacity,
          availability: vehicle.availability,
          documents: vehicleDocuments,
        })
      }
      const result = await partnerApi.apply({
        businessName: String(data.get('name') ?? ''),
        partnerType: String(data.get('partnerType') ?? ''),
        phone: otpEnabled ? phone : String(data.get('phone') ?? ''),
        phoneChallengeId: otpEnabled ? phoneChallengeId ?? undefined : undefined,
        uploadBatchId: otpEnabled && documents.length > 0 ? applicationId : undefined,
        whatsapp: String(data.get('whatsapp') ?? ''),
        email: String(data.get('email') ?? ''),
        zone: String(data.get('zone') ?? ''),
        address: String(data.get('address') ?? ''),
        serviceCodes: selectedServices,
        vehicleCount: submittedVehicles.length,
        registration: submittedVehicles[0]?.registrationNumber ?? '',
        capacity: submittedVehicles[0]?.capacity ?? '',
        vehicles: submittedVehicles,
        experience: data.get('experience') ? Number(data.get('experience')) : undefined,
        availability: String(data.get('availability') ?? ''),
        notes: String(data.get('notes') ?? ''),
        documents,
      })
      setSubmitted(true)
      setPartnerFormDirty(false)
      notifySuccess(p.messages.submitted(result.message, result.reference))
    } catch (error) {
      setSubmitted(false)
      notifyError(error instanceof Error ? error.message : p.messages.submitFailed)
    }
  }

  return <div className="partner-screen">
    <section className="partner-hero">
      <div>
        <p className="eyebrow">{p.hero.eyebrow}</p>
        <h1>{p.hero.titleLead}<br /><em>{p.hero.titleEmphasis}</em></h1>
        <p>{p.hero.copy}</p>
      </div>
      <div className="partner-hero-stats">
        {p.hero.highlights.map((item) => <span key={item.value}><b>{item.value}</b><small>{item.label}</small></span>)}
      </div>
    </section>
    <form className="partner-application" onChange={() => { if (!submitted) setPartnerFormDirty(true) }} onSubmit={submit} noValidate>
        <div className="partner-form-intro">
          <div><p className="eyebrow">{p.intro.eyebrow}</p><h2>{p.intro.title}</h2><p>{p.intro.copy}</p></div>
          <span>{p.intro.badge}</span>
        </div>
        {!featureFlags.isSuccess && (
          <section className="partner-form-section" role={featureFlags.isError ? 'alert' : 'status'}>
            <p>{featureFlags.isError ? p.verification.flagsUnavailable : p.verification.loadingFlags}</p>
            {featureFlags.isError && <button className="button button-quiet" type="button" onClick={() => { void featureFlags.refetch() }}>Try again</button>}
          </section>
        )}
        {featureFlags.isSuccess && otpEnabled && !phoneVerified && (
          <section className="partner-form-section">
            <Step number={p.sections.business.number} title={p.verification.title} copy={p.verification.copy} />
            <div className="partner-field-grid">
              <label className="partner-field">
                {p.verification.phoneLabel}
                <input
                  name="phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={phone}
                  onChange={(event) => {
                    setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))
                    setPhoneChallengeId(null)
                    setPhoneOtpChannel(null)
                    setPhoneVerified(false)
                    setOtp('')
                  }}
                  placeholder={p.fields.phone.placeholder}
                  required
                />
              </label>
              {phoneChallengeId && (
                <div className={`otp-delivery otp-delivery-${phoneOtpChannel ?? 'unknown'}`} role="status">
                  {phoneOtpChannel === 'whatsapp'
                    ? <MessageCircle size={18} aria-hidden="true" />
                    : <MessageSquare size={18} aria-hidden="true" />}
                  <span>
                    {phoneOtpChannel
                      ? `We sent a code via ${phoneOtpChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 ${phone}.`
                      : `Enter the phone code sent to +91 ${phone}.`}
                  </span>
                </div>
              )}
              {phoneChallengeId && (
                <label className="partner-field">
                  {p.verification.otpLabel}
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete={phoneOtpChannel === 'sms' ? 'one-time-code' : 'off'}
                    maxLength={6}
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                </label>
              )}
            </div>
            <div className="partner-otp-actions">
              <button className="button button-primary" type="button" onClick={() => {
                if (phoneVerifyDialogEnabled && user?.phoneVerified === false) {
                  setPhoneVerifyDialogOpen(true)
                } else {
                  void requestPhoneOtp()
                }
              }} disabled={otpBusy || phone.length !== 10}>
                {phoneVerifyDialogEnabled && user?.phoneVerified === false
                  ? 'Verify account phone'
                  : phoneChallengeId ? p.verification.resendCode : p.verification.sendCode}
              </button>
              {phoneChallengeId && (
                <button className="button button-quiet" type="button" onClick={() => { void verifyPhoneOtp() }} disabled={otpBusy || otp.length !== 6}>
                  {p.verification.verifyCode}
                </button>
              )}
            </div>
          </section>
        )}
        {featureFlags.isSuccess && (!otpEnabled || phoneVerified) && <>
          {otpEnabled && <>
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="phoneChallengeId" value={phoneChallengeId ?? ''} />
            <div className="partner-phone-verified" role="status">
              <span><Check size={16} /> {p.verification.verifiedLabel}: {phone}</span>
              <button className="button button-quiet" type="button" onClick={changePhone}>{p.verification.changePhone}</button>
            </div>
          </>}
          <section className="partner-form-section">
            <Step number={p.sections.business.number} title={p.sections.business.title} copy={p.sections.business.copy} />
            <div className="partner-field-grid">
              <Field label={p.fields.businessName.label} name="name" placeholder={p.fields.businessName.placeholder} required />
              <label className="partner-field">{p.fields.partnerType.label}<select name="partnerType" required defaultValue=""><option value="" disabled>{p.fields.partnerType.placeholder}</option>{p.options.partnerTypes.map((option) => <option key={option.label}>{option.label}</option>)}</select></label>
              {!otpEnabled && <Field label={p.fields.phone.label} name="phone" placeholder={p.fields.phone.placeholder} inputMode="numeric" required />}
              <Field label={p.fields.whatsapp.label} name="whatsapp" placeholder={p.fields.whatsapp.placeholder} inputMode="numeric" />
              <Field label={p.fields.email.label} name="email" placeholder={p.fields.email.placeholder} type="email" required />
              <Field label={p.fields.zone.label} name="zone" placeholder={p.fields.zone.placeholder} required />
            </div>
            <label className="partner-field">{p.fields.address.label}<textarea name="address" rows={2} required placeholder={p.fields.address.placeholder} /></label>
          </section>
          <section className="partner-form-section">
            <Step number={p.sections.services.number} title={p.sections.services.title} copy={p.sections.services.copy} />
            <fieldset className="partner-services">
              <legend className="sr-only">{p.sections.services.legend}</legend>
              <div className="service-choice-grid">
                {p.options.serviceOffers.map((service) => <label className={`service-choice ${selectedServices.includes(service.code) ? 'is-selected' : ''}`} key={service.code}>
                  <input type="checkbox" checked={selectedServices.includes(service.code)} onChange={() => toggleService(service.code)} />
                  <span>{selectedServices.includes(service.code) ? <Check size={16} /> : <span className="service-choice-dot" />} {service.label}</span>
                </label>)}
              </div>
            </fieldset>
          </section>
          <section className="partner-form-section">
            <Step number={p.sections.fleet.number} title={p.sections.fleet.title} copy={p.sections.fleet.copy} />
            <div className="partner-vehicle-list">
              <div className="partner-vehicle-list-heading">
                <p>{p.fields.vehicleCount.label}: <strong>{vehicles.length}</strong></p>
                <button className="button button-quiet" type="button" onClick={addVehicle} disabled={vehicles.length >= 250}><Plus size={15} /> Add vehicle</button>
              </div>
              {vehicles.map((vehicle, index) => <fieldset className="partner-vehicle-card" key={vehicle.id}>
                <legend>Vehicle {index + 1}</legend>
                {vehicles.length > 1 && <button className="button button-quiet partner-vehicle-remove" type="button" onClick={() => removeVehicle(vehicle.id)} aria-label={`Remove vehicle ${index + 1}`}><Trash2 size={15} /></button>}
                <div className="partner-field-grid">
                  <Field label={p.fields.registration.label} name={`vehicleRegistration-${index}`} placeholder={p.fields.registration.placeholder} required />
                  <label className="partner-field">{p.fields.vehicleType.label}<select name={`vehicleType-${index}`} required defaultValue=""><option value="" disabled>{p.fields.vehicleType.placeholder}</option>{p.options.vehicleTypes.map((option) => <option key={option.label}>{option.label}</option>)}</select></label>
                  <label className="partner-field">{p.fields.serviceCategory.label}<select name={`vehicleService-${index}`} required defaultValue=""><option value="" disabled>{p.fields.serviceCategory.placeholder}</option>{selectedServices.map((service) => <option key={service}>{service}</option>)}</select></label>
                  <Field label={p.fields.capacity.label} name={`vehicleCapacity-${index}`} placeholder={p.fields.capacity.placeholder} required />
                  <label className="partner-field">{p.fields.availability.label}<select name={`vehicleAvailability-${index}`} defaultValue={p.options.availability[0].label}>{p.options.availability.map((option) => <option key={option.label}>{option.label}</option>)}</select></label>
                  <label className="partner-field">{p.fields.documents.label}<input name={`vehicleDocuments-${index}`} type="file" multiple accept="image/jpeg,image/png,image/webp,.pdf,.doc,.docx" /><small>{p.fields.documents.hint}</small></label>
                </div>
              </fieldset>)}
            </div>
            <div className="partner-field-grid">
              <Field label={p.fields.experience.label} name="experience" type="number" placeholder={p.fields.experience.placeholder} />
              <label className="partner-field">{p.fields.availability.label}<select name="availability" defaultValue={p.options.availability[0].label}>{p.options.availability.map((option) => <option key={option.label}>{option.label}</option>)}</select></label>
            </div>
            <label className="partner-field">{p.fields.notes.label}<textarea name="notes" rows={3} placeholder={p.fields.notes.placeholder} /></label>
          </section>
          <label className="partner-declaration"><input name="declaration" type="checkbox" required /><span>{p.declaration}</span></label>
          <button className="button button-primary partner-submit" type="submit">{p.actions.submit} <ArrowRight size={15} /></button>
          {submitted && <button className="button button-quiet partner-login-action" type="button" onClick={openVendorWorkspace}>{p.actions.continueToVendorLogin}</button>}
        </>}
    </form>
    <aside className="partner-side-card">
      <p className="eyebrow">{p.nextSteps.eyebrow}</p>
      <h2>{p.nextSteps.title}</h2>
      <ol>{p.nextSteps.steps.map((step, index) => <li key={step.title}><span>{index + 1}</span><div><b>{step.title}</b><small>{step.copy}</small></div></li>)}</ol>
      <div className="partner-help">
        <b>{p.help.title}</b>
        <p>{p.help.copy}</p>
        <button className="button button-quiet" type="button" onClick={openVendorWorkspace}>{user ? p.actions.openWorkspace : p.actions.goToVendorLogin}</button>
      </div>
    </aside>
    {phoneVerifyDialogEnabled && phoneVerifyDialogOpen && <PhoneVerifyDialog
      initialPhone={phone || user?.phone}
      allowSkip={false}
      onClose={() => setPhoneVerifyDialogOpen(false)}
      onVerified={async (result) => {
        setPhone(result.phone)
        setPhoneChallengeId(result.challengeId)
        setPhoneOtpChannel(null)
        setOtp('')
        setPhoneVerified(true)
        const current = useAuthStore.getState().user
        if (current) setAuthUser({ ...current, phone: result.phone, phoneVerified: true })
        try {
          const profile = await authApi.me()
          setAuthUser(profile.user)
        } catch (profileError) {
          notifyError(profileError instanceof Error ? profileError.message : 'Your profile could not be refreshed.')
        }
        notifySuccess(p.verification.verified)
      }}
    />}
  </div>
}

function Step({ number, title, copy }: { number: string; title: string; copy: string }) {
  return <div className="partner-step"><i>{number}</i><div><h3>{title}</h3><p>{copy}</p></div></div>
}

function Field({ label, name, placeholder, type = 'text', inputMode, required }: { label: string; name: string; placeholder: string; type?: string; inputMode?: 'numeric'; required?: boolean }) {
  return <label className="partner-field">{label}<input name={name} type={type} inputMode={inputMode} placeholder={placeholder} required={required} /></label>
}
