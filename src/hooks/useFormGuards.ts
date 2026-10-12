import { useEffect } from 'react'

function today() {
  const date = new Date()
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

function fieldLabel(input: HTMLInputElement) {
  return input.closest('label')?.textContent?.toLowerCase() ?? ''
}

function configure(root: ParentNode = document) {
  const currentDate = today()
  root.querySelectorAll<HTMLInputElement>('input[type="date"]').forEach((input) => {
    input.min = currentDate
    input.setCustomValidity(input.value && input.value < currentDate ? 'Choose today or a future date.' : '')
  })
  root.querySelectorAll<HTMLInputElement>('input[name="registration"]').forEach((input) => {
    input.inputMode = 'text'
    input.pattern = '[A-Z]{2}\\s?[0-9]{1,2}\\s?[A-Z]{1,3}\\s?[0-9]{1,4}'
    input.title = 'Use a valid registration such as TN 38 AB 4120.'
    input.value = input.value.toUpperCase()
  })
  root.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
    const label = fieldLabel(input)
    if (/full name|driver name|^name$/.test(label)) {
      input.maxLength = 60
      input.pattern = "[A-Za-z .'-]{2,60}"
      input.title = 'Use 2 to 60 letters, spaces, apostrophes, periods, or hyphens.'
    }
    if (input.type === 'email' || /email address|email/.test(label)) {
      input.type = 'email'
      input.maxLength = 254
      input.pattern = '[^\\s@]+@[^\\s@]+\\.[^\\s@]+'
      input.title = 'Enter a valid email address.'
    }
  })
  root.querySelectorAll<HTMLInputElement>('input[type="tel"]').forEach((input) => {
    input.inputMode = 'numeric'
    input.pattern = '[0-9]{10}'
    input.maxLength = 10
    input.title = 'Enter a valid 10-digit mobile number.'
  })
  root.querySelectorAll<HTMLInputElement>('label input').forEach((input) => {
    if (!/mobile number|phone number/.test(fieldLabel(input))) return
    input.type = 'tel'
    input.inputMode = 'numeric'
    input.pattern = '[0-9]{10}'
    input.maxLength = 10
  })
}

export function useFormGuards() {
  useEffect(() => {
    configure()
    const onInput = (event: Event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement)) return
      const label = fieldLabel(input)
      if (input.type === 'tel' || /mobile number|phone number/.test(label)) {
        input.value = input.value.replace(/\D/g, '').slice(0, 10)
        input.setCustomValidity(input.value.length === 10 ? '' : 'Enter a valid 10-digit mobile number.')
      }
      if (/full name|driver name|^name$/.test(label)) {
        input.setCustomValidity(input.value.length >= 2 && input.value.length <= 60 && /^[A-Za-z .'-]+$/.test(input.value) ? '' : 'Use 2 to 60 valid name characters.')
      }
      if (input.type === 'email' || /email address|email/.test(label)) {
        input.setCustomValidity(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value) && input.value.length <= 254 ? '' : 'Enter a valid email address.')
      }
      if (input.name === 'registration') input.value = input.value.toUpperCase().replace(/[^A-Z0-9 ]/g, '')
      if (input.type === 'date') {
        const currentDate = today()
        input.min = currentDate
        input.setCustomValidity(input.value && input.value < currentDate ? 'Choose today or a future date.' : '')
      }
    }
    const onSubmit = (event: Event) => {
      const form = event.target
      if (!(form instanceof HTMLFormElement)) return
      configure(form)
      if (!form.checkValidity()) {
        event.preventDefault()
        form.reportValidity()
      }
    }
    const observer = new MutationObserver(() => configure())
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('input', onInput, true)
    document.addEventListener('submit', onSubmit, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('input', onInput, true)
      document.removeEventListener('submit', onSubmit, true)
    }
  }, [])
}
