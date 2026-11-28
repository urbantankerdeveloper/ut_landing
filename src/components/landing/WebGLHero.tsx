import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export default function WebGLHero() {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    } catch {
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    renderer.setSize(host.clientWidth, host.clientHeight)
    host.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(35, host.clientWidth / host.clientHeight, .1, 100)
    camera.position.set(5, 3, 8)
    camera.lookAt(0, 0, 0)
    const tanker = new THREE.Group()
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3.8, 20), new THREE.MeshStandardMaterial({ color: 0x27b5a8 }))
    tank.rotation.z = Math.PI / 2
    tanker.add(tank)
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.4, 2), new THREE.MeshStandardMaterial({ color: 0xeefcf9 }))
    cab.position.set(-2.4, -.1, 0)
    tanker.add(cab)
    for (const x of [-2, -.5, 1.8]) {
      for (const z of [-1.25, 1.25]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.55, .55, .28, 16), new THREE.MeshStandardMaterial({ color: 0x163c3a }))
        wheel.rotation.x = Math.PI / 2
        wheel.position.set(x, -.9, z)
        tanker.add(wheel)
      }
    }
    scene.add(tanker)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x163c3a, 2))
    let frame = 0
    let visible = true
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting })
    observer.observe(host)
    const render = () => {
      if (!document.hidden && visible) {
        tanker.rotation.y += .002
        renderer.render(scene, camera)
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)
    const pointer = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect()
      tanker.rotation.x = ((event.clientY - rect.top) / rect.height - .5) * .12
      tanker.rotation.z = ((event.clientX - rect.left) / rect.width - .5) * .12
    }
    host.addEventListener('pointermove', pointer)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      host.removeEventListener('pointermove', pointer)
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [])

  return <div ref={hostRef} className="home-webgl-hero" aria-hidden="true" />
}
