import { DEFAULT_BPM, DEFAULT_DUCK_DB, type BoothEvent, type BoothState, type ColorPreset, type Eq, type Pad, type XY } from '#shared/types/booth'

type HoldName = 'talkover' | 'echo' | 'brake' | 'rewind' | 'build' | 'lights' | 'pitchUp' | 'pitchDown'

/**
 * The booth (pads, holds, XY pad, colour, EQ). The server holds the shared state and relays
 * every change and pad hit to all open pages (server-sent events). Each listening page plays
 * the effects itself, so the page you press on reacts at once, and the other listening
 * devices follow within a few ms.
 */
export const useBooth = defineSingleton(() => {
  const booth = ref<BoothState>({ eq: { low: 0, mid: 0, high: 0 }, color: 'off', duckDb: DEFAULT_DUCK_DB, padVolume: 0.8, talkover: false, echo: false, brake: false, rewind: false, build: false, stutter: null, xy: null, pads: [], lights: false, pitchUp: false, pitchDown: false, bpm: null })
  const pads = ref<Pad[]>([])
  const fxError = ref('')
  /** Hold buttons pressed here count at once, before the server confirms. */
  const held = reactive<Record<string, boolean>>({})
  /** XY pad position under this device's finger (null when not touching it here). */
  const xyLocal = ref<XY | null>(null)
  const xyShown = computed(() => xyLocal.value ?? booth.value.xy)
  /** Stutter length under this device's finger (beats; null when not held here). */
  const stutterLocal = ref<number | null>(null)
  const stutterShown = computed(() => stutterLocal.value ?? booth.value.stutter)
  const clientId = Math.random().toString(36).slice(2)
  let eqEditedAt = 0
  let events: EventSource | null = null
  const audio = () => useListening().getAudio()

  function showFxError(msg: string) {
    fxError.value = msg
    setTimeout(() => (fxError.value = ''), 4000)
  }

  function setBooth(s: BoothState) {
    // While a slider is being dragged here, the server's echo of an older value would jump it back.
    if (Date.now() - eqEditedAt < 1000) s = { ...s, eq: booth.value.eq }
    booth.value = s
  }

  /** Apply the shared state (and what's held here) to this device's audio. */
  function apply() {
    const a = audio()
    if (!a) return
    const b = booth.value
    a.setEq(b.eq)
    a.setColor(b.color)
    a.setDuckDb(b.duckDb)
    a.setPadVolume(b.padVolume)
    a.setPitchBend(Number(!!held.pitchUp || b.pitchUp) - Number(!!held.pitchDown || b.pitchDown))
    a.setTalkover(!!held.talkover || b.talkover)
    a.setEcho(!!held.echo || b.echo)
    a.setBrake(!!held.brake || b.brake)
    a.setRewind(!!held.rewind || b.rewind)
    a.setBuild(!!held.build || b.build, b.bpm ?? DEFAULT_BPM)
    a.setStutter(stutterLocal.value ?? b.stutter, b.bpm ?? DEFAULT_BPM)
    a.setXY(xyLocal.value ?? b.xy)
  }
  watch([booth, held, xyLocal, stutterLocal], apply, { deep: true })

  /** This device just started listening: give its audio the voice, the state and the pads. */
  function attach(a: BoothAudio) {
    a.setVoicePreset(useVoice().voicePreset.value)
    apply()
    a.loadPads(pads.value)
  }

  /** Send a booth command; the reply is the new shared state. */
  async function fx(action: string, extra: Record<string, unknown> = {}) {
    fxError.value = ''
    try {
      setBooth(await $fetch<BoothState>('/api/fx', { method: 'POST', body: { action, from: clientId, ...extra } }))
    } catch (e: any) {
      showFxError(errorMessage(e))
      // A pad deleted elsewhere while this page wasn't told: stop it here and refresh the list.
      if (action === 'pad' && e?.response?.status === 404) {
        void audio()?.pad(String(extra.id), false)
        void reloadPads()
      }
    }
  }

  function connect() {
    events = new EventSource('/api/fx/events') // reconnects by itself
    // After a reconnection: pads may have been added or deleted meanwhile.
    let opened = false
    events.onopen = () => (opened ? void reloadPads() : (opened = true))
    events.onmessage = (m) => {
      const e = JSON.parse(m.data) as BoothEvent
      if (e.type === 'state') return setBooth(e.state)
      if (e.type === 'padsChanged') return void reloadPads()
      if (e.from === clientId) return // already played here
      if (e.type === 'pad') void audio()?.pad(e.id, e.on)
      else if (e.type === 'stopPads') audio()?.stopPads()
    }
  }

  // ------------------------------------------------------------------ pads
  async function reloadPads() {
    pads.value = await $fetch<Pad[]>('/api/pads').catch(() => pads.value)
    audio()?.loadPads(pads.value)
  }

  function hitPad(p: Pad) {
    if (!useListening().listening.value && !useEngine().eng.value?.listeners) {
      return showFxError('Pads play on the listening devices: tap "Listen here" first.')
    }
    // Every pad toggles: tap it again while it plays to stop it.
    const a = audio()
    const on = !(a ? a.isPlaying(p.id) : booth.value.pads.includes(p.id))
    void a?.pad(p.id, on)
    booth.value.pads = on ? [...booth.value.pads, p.id] : booth.value.pads.filter((x) => x !== p.id)
    fx('pad', { id: p.id, on })
    navigator.vibrate?.(15)
  }

  function stopPads() {
    audio()?.stopPads()
    booth.value.pads = []
    fx('stopPads')
  }

  async function deletePad(p: Pad) {
    await $fetch(`/api/pads/${encodeURIComponent(p.id)}`, { method: 'DELETE' }).catch(() => showFxError('Could not delete the pad'))
    await reloadPads()
  }

  // ------------------------------------------------------- music effects
  function setColor(c: ColorPreset) {
    booth.value.color = c
    fx('color', { color: c })
  }

  function setFxValue(action: 'duck' | 'padVolume', value: number) {
    booth.value[action === 'duck' ? 'duckDb' : 'padVolume'] = value
    fx(action, { value })
  }

  let eqTimer: ReturnType<typeof setTimeout> | undefined
  function setEq(band: keyof Eq, v: number) {
    booth.value.eq = { ...booth.value.eq, [band]: v }
    eqEditedAt = Date.now()
    clearTimeout(eqTimer)
    eqTimer = setTimeout(() => fx('eq', { eq: booth.value.eq }), 60)
  }
  function resetEq() {
    booth.value.eq = { low: 0, mid: 0, high: 0 }
    eqEditedAt = Date.now()
    fx('eq', { eq: booth.value.eq })
  }

  // ---------------------------------------------------------------- holds
  /** "On" + keep-alive every 2 s while pressed (the server releases after 6 s otherwise). */
  const holdTimers: Partial<Record<HoldName, ReturnType<typeof setInterval>>> = {}
  function holdStart(name: HoldName) {
    if (held[name]) return
    held[name] = true
    if (name === 'talkover') useVoice().start()
    fx(name, { on: true })
    holdTimers[name] = setInterval(() => fx(name, { on: true }), 2000)
    navigator.vibrate?.(10)
  }
  function holdEnd(name: HoldName) {
    if (!held[name]) return
    held[name] = false
    if (name === 'talkover') void audio()?.voice(false)
    clearInterval(holdTimers[name])
    fx(name, { on: false })
  }

  async function start() {
    connect()
    await reloadPads()
  }
  function stop() {
    events?.close()
    for (const t of Object.values(holdTimers)) clearInterval(t)
  }

  return {
    booth, pads, fxError, held, xyLocal, xyShown, stutterLocal, stutterShown,
    showFxError, attach, fx, reloadPads, hitPad, stopPads, deletePad,
    setColor, setFxValue, setEq, resetEq, holdStart, holdEnd, start, stop,
  }
})
