// Foreground-only alert for a new vendor order. Background alerts come from push notifications.
export function playNewOrderAlert() {
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])
  if (!window.AudioContext) return
  const context = new window.AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.type = 'sine'
  oscillator.frequency.value = 880
  gain.gain.value = 0.15
  oscillator.connect(gain).connect(context.destination)
  oscillator.onended = () => void context.close()
  oscillator.start()
  oscillator.stop(context.currentTime + 0.3)
}
