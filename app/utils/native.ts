import { Capacitor, registerPlugin } from '@capacitor/core'
import { KeepAwake } from '@capacitor-community/keep-awake'

/**
 * The few things the Android app does natively (android/…/NowPlayingPlugin.java); on the web
 * every function here is a no-op and the browser APIs are used instead.
 */
export const isNative = () => Capacitor.isNativePlatform()

export type MediaAction = 'play' | 'pause' | 'next' | 'prev'

interface NowPlayingPlugin {
  /** Shows / refreshes the media notification; it runs a foreground service so audio keeps going with the screen off. */
  update(o: { title: string; artist: string; playing: boolean }): Promise<void>
  /** Removes the notification and stops the service. */
  stop(): Promise<void>
  /** Light show: turns the screen on, over the lock screen, while on. */
  wake(o: { on: boolean }): Promise<void>
  addListener(event: 'action', cb: (e: { action: MediaAction }) => void): Promise<{ remove(): Promise<void> }>
}
const NowPlaying = registerPlugin<NowPlayingPlugin>('NowPlaying')

const meta = { title: 'Tape Twist', artist: '' }
let playing = false

function push() {
  if (!isNative()) return
  void (playing ? NowPlaying.update({ ...meta, playing }) : NowPlaying.stop()).catch(() => {})
}

/** The track shown in the notification. */
export function nativeMeta(title: string | undefined, artist: string | undefined) {
  meta.title = title || 'Tape Twist'
  meta.artist = artist || ''
  push()
}

/** This device plays audio (listening) or not: starts / stops the background service. */
export function nativePlaying(on: boolean) {
  playing = on
  push()
}

/** Notification / headset buttons (one handler: a later call replaces the earlier one). */
let actionCb: ((a: MediaAction) => void) | null = null
export function onNativeMediaAction(cb: (a: MediaAction) => void) {
  if (!isNative()) return
  if (!actionCb) void NowPlaying.addListener('action', (e) => actionCb?.(e.action))
  actionCb = cb
}

/** Light show in the app: lights the screen up (locked or asleep) and shows the app over the lock screen. */
export function nativeWake(on: boolean) {
  if (isNative()) void NowPlaying.wake({ on }).catch(() => {})
}

/** Keeps the screen on (the WebView has no Screen Wake Lock API). */
export function nativeKeepAwake(on: boolean) {
  if (isNative()) void (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {})
}
