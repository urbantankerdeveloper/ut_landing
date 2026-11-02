// Opens the device's front camera for a selfie and turns the current frame into a JPEG file.
export type CameraFailure = 'unsupported' | 'no-camera' | 'permission-denied' | 'failed'

export class CameraUnavailableError extends Error {
  reason: CameraFailure

  constructor(reason: CameraFailure) {
    super(reason)
    this.reason = reason
  }
}

export async function openFrontCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraUnavailableError('unsupported')
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false })
  } catch (error) {
    const name = error instanceof DOMException ? error.name : ''
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraUnavailableError('no-camera')
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraUnavailableError('permission-denied')
    throw new CameraUnavailableError('failed')
  }
}

// Mirrors the frame, so the saved photo matches the mirrored preview the user sees.
export async function captureFrameAsFile(video: HTMLVideoElement): Promise<File> {
  const canvas = document.createElement('canvas')
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('The photo could not be captured. Try again.')
  context.translate(canvas.width, 0)
  context.scale(-1, 1)
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('The photo could not be captured. Try again.')
  return new File([blob], 'selfie.jpg', { type: 'image/jpeg' })
}
