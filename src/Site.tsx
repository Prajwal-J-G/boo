import { useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, Heart, LockKeyhole, LogOut, Plus, X } from 'lucide-react'
import { NotebookComposer } from './NotebookComposer'
import './Site.css'

type Entry = {
  id: string
  kind: 'letter' | 'diary' | 'memory' | 'reply'
  title: string
  body: string
  date: string
  author?: string
  replyTo?: string
  imageKey?: string
  imageUrl?: string
  imageAlt?: string
}

const env = import.meta.env
const authConfigured = Boolean(env.VITE_COGNITO_USER_POOL_ID && env.VITE_COGNITO_CLIENT_ID)
const apiUrl = env.VITE_API_URL
let authReady = false

async function loadAuth() {
  const [amplify, auth] = await Promise.all([import('aws-amplify'), import('aws-amplify/auth')])
  if (authConfigured && !authReady) {
    amplify.Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: env.VITE_COGNITO_USER_POOL_ID!,
          userPoolClientId: env.VITE_COGNITO_CLIENT_ID!,
          loginWith: { email: true },
        },
      },
    })
    authReady = true
  }
  return auth
}

const previewEntries: Entry[] = [
  { id: 'm1', kind: 'memory', title: 'The long way home', body: 'We missed the turning, found a tiny place still serving coffee, and somehow made an ordinary Tuesday feel like a story I want to keep telling.', date: 'OCTOBER 18, 2025', imageUrl: 'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=1400&q=85', imageAlt: 'Two people watching the sunset together' },
  { id: 'm2', kind: 'memory', title: 'Sunday, in soft focus', body: 'Rain at the windows. Your socked feet under my leg. Nothing on the calendar and nowhere else I wanted to be.', date: 'SEPTEMBER 07, 2025', imageUrl: 'https://images.unsplash.com/photo-1511988617509-a57c8a288659?auto=format&fit=crop&w=1000&q=85', imageAlt: 'A warm moment shared between loved ones' },
  { id: 'm3', kind: 'memory', title: 'A little more of everywhere', body: 'Every place gets better when I get to turn and find you there.', date: 'JUNE 22, 2025', imageUrl: 'https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=1000&q=85', imageAlt: 'A golden field at the end of the day' },
  { id: 'l1', kind: 'letter', title: 'For the days you forget', body: 'You make the world feel less hurried. You notice the small things, remember what matters to people, and give your whole heart without making a show of it. I hope you know how extraordinary that is. When I don’t say it enough, let this be one more way: loving you is my favorite part of being here.', date: 'A LETTER, LEFT OPEN' },
  { id: 'r1', kind: 'reply', title: 'Re: For the days you forget', body: 'I read this twice, then tucked it away like a little treasure. I love the ordinary Tuesdays with you most of all.', date: 'OCTOBER 19, 2025', author: 'A NOTE BACK', replyTo: 'l1' },
  { id: 'd1', kind: 'diary', title: 'The little things are the big things', body: 'I caught myself smiling at the grocery store because I remembered the way you dance when you think nobody is looking. Our life keeps finding ways to surprise me with you.', date: 'A NOTE FROM THE MARGINS' },
]

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiUrl) throw new Error('API is not configured')
  const { fetchAuthSession } = await loadAuth()
  const token = (await fetchAuthSession()).tokens?.accessToken.toString()
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...init?.headers },
  })
  if (!response.ok) throw new Error(`Request failed (${response.status})`)
  return response.json() as Promise<T>
}

async function optimizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image processing is unavailable')
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image compression failed')), 'image/jpeg', .84))
}

function localDateValue() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function Site() {
  const [entries, setEntries] = useState<Entry[]>(env.DEV ? previewEntries : [])
  const [activePhoto, setActivePhoto] = useState<Entry | null>(null)
  const [authenticated, setAuthenticated] = useState(env.DEV && !authConfigured)
  const [authChecked, setAuthChecked] = useState(env.DEV || !authConfigured)
  const [isOwner, setIsOwner] = useState(env.DEV && !authConfigured)
  const [userEmail, setUserEmail] = useState('')
  const [authError, setAuthError] = useState('')
  const [newPasswordRequired, setNewPasswordRequired] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [composerMode, setComposerMode] = useState<'entry' | 'reply'>('entry')
  const [replyTarget, setReplyTarget] = useState<Entry | null>(null)

  useEffect(() => {
    if (!authConfigured) return
    loadAuth().then(({ getCurrentUser, fetchAuthSession }) => getCurrentUser().then(async (user) => {
      const session = await fetchAuthSession()
      const groups = session.tokens?.accessToken.payload['cognito:groups']
      setAuthenticated(Boolean(user))
      setUserEmail(user?.signInDetails?.loginId ?? '')
      setIsOwner(Array.isArray(groups) && groups.includes('Owners'))
      setAuthChecked(true)
    })).catch(() => setAuthChecked(true))
  }, [])

  useEffect(() => {
    if (!authenticated || env.DEV) return
    apiRequest<{ entries: Entry[] }>('/content').then((result) => setEntries(result.entries)).catch(() => setEntries([]))
  }, [authenticated])

  const memories = entries.filter((entry) => entry.kind === 'memory')
  const letters = entries.filter((entry) => entry.kind === 'letter')
  const diary = entries.filter((entry) => entry.kind === 'diary')

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setAuthError('')
    try {
      const { signIn, fetchAuthSession } = await loadAuth()
      const result = await signIn({ username: String(form.get('email')), password: String(form.get('password')) })
      setUserEmail(String(form.get('email')))
      if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setNewPasswordRequired(true)
      } else {
        const session = await fetchAuthSession()
        const groups = session.tokens?.accessToken.payload['cognito:groups']
        setIsOwner(Array.isArray(groups) && groups.includes('Owners'))
        setAuthenticated(true)
      }
    } catch {
      setAuthError('That sign-in did not work. Check the email and password, then try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleNewPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setAuthError('')
    try {
      const { confirmSignIn, fetchAuthSession } = await loadAuth()
      await confirmSignIn({ challengeResponse: String(form.get('password')) })
      const session = await fetchAuthSession()
      const groups = session.tokens?.accessToken.payload['cognito:groups']
      setIsOwner(Array.isArray(groups) && groups.includes('Owners'))
      setNewPasswordRequired(false)
      setAuthenticated(true)
    } catch {
      setAuthError('Please choose a password that meets the account requirements.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    setBusy(true)
    setAuthError('')
    try {
      const photo = composerMode === 'entry' ? form.get('photo') : null
      let imageKey: string | undefined
      const localPreview = env.DEV && !authConfigured
      if (photo instanceof File && photo.size > 0) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type) || photo.size > 10 * 1024 * 1024) throw new Error('Unsupported or oversized image')
        if (!localPreview) {
          const optimized = await optimizePhoto(photo)
          const upload = await apiRequest<{ uploadUrl: string; imageKey: string }>('/media/upload-url', { method: 'POST', body: JSON.stringify({ contentType: 'image/jpeg' }) })
          const uploaded = await fetch(upload.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: optimized })
          if (!uploaded.ok) throw new Error('Photo upload failed')
          imageKey = upload.imageKey
        }
      }
      const isReply = composerMode === 'reply'
      const date = String(form.get('date') || localDateValue())
      const payload = {
        kind: isReply ? 'reply' as const : String(form.get('kind')) as Entry['kind'],
        title: isReply ? `Re: ${replyTarget?.title ?? ''}` : String(form.get('title')),
        body: String(form.get('body')),
        date,
        replyTo: isReply ? replyTarget?.id : undefined,
        imageKey,
      }
      const entry: Entry = localPreview
        ? { ...payload, id: crypto.randomUUID(), date: new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }), author: isReply ? 'A NOTE BACK' : undefined, imageUrl: photo instanceof File && photo.size > 0 ? URL.createObjectURL(await optimizePhoto(photo)) : undefined }
        : await apiRequest<Entry>('/content', { method: 'POST', body: JSON.stringify(payload) })
      setEntries((current) => [entry, ...current])
      setEditorOpen(false)
      setReplyTarget(null)
      formElement.reset()
    } catch {
      setAuthError('Could not save this page. Check the photo size and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSignOut() {
    const { signOut } = await loadAuth()
    await signOut()
    setAuthenticated(false)
    setEntries([])
  }

  function openReply(letter: Entry) {
    setComposerMode('reply')
    setReplyTarget(letter)
    setAuthError('')
    setEditorOpen(true)
  }

  function openEntryComposer() {
    setComposerMode('entry')
    setReplyTarget(null)
    setAuthError('')
    setEditorOpen(true)
  }

  function closeComposer() {
    setEditorOpen(false)
    setReplyTarget(null)
  }

  if (!authChecked) return <main className="gate-loading"><Heart size={20} /> Opening your little world...</main>

  if (!authenticated) return (
    <main className="login-screen">
      <div className="login-photo" role="img" aria-label="A quiet, golden-hour landscape" />
      <section className="login-panel">
        <div className="brand-mark"><Heart size={16} fill="currentColor" /></div>
        <p className="eyebrow">A PRIVATE LITTLE WORLD</p>
        <h1>Just us,<br /><em>always.</em></h1>
        <p className="login-copy">Some things are meant to be kept close. Sign in to open our letters and memories.</p>
        <form onSubmit={newPasswordRequired ? handleNewPassword : handleLogin} className="login-form">
          {!newPasswordRequired && <label>Email address<input name="email" type="email" autoComplete="username" required placeholder="you@example.com" /></label>}
          <label>{newPasswordRequired ? 'Choose a new password' : 'Password'}<input name="password" type="password" autoComplete={newPasswordRequired ? 'new-password' : 'current-password'} required minLength={newPasswordRequired ? 8 : undefined} /></label>
          {authError && <p className="form-error" role="alert">{authError}</p>}
          <button className="button button-dark" type="submit" disabled={busy}>{busy ? 'One moment…' : newPasswordRequired ? 'Set password' : 'Come on in'}<ArrowRight size={16} /></button>
        </form>
        <p className="login-foot"><LockKeyhole size={13} /> Invitation only</p>
      </section>
    </main>
  )

  return <div className="site-shell">
    <header className="topbar">
      <a className="wordmark" href="#home"><span className="brand-mark"><Heart size={15} fill="currentColor" /></span>our, always</a>
      <nav className="main-nav" aria-label="Main navigation"><a href="#letters">Letters</a><a href="#diary">Diary</a><a href="#moments">Our moments</a></nav>
      <div className="top-actions">
        {env.DEV && <span className="preview-tag">PREVIEW</span>}
        {authConfigured && <button className="icon-button" type="button" title={`Sign out ${userEmail}`} onClick={handleSignOut}><LogOut size={17} /></button>}
        {isOwner && <button className="button button-small" type="button" onClick={openEntryComposer}><Plus size={15} /> Add a note</button>}
      </div>
    </header>

    <main id="home">
      <section className="opening section-wrap">
        <motion.div className="opening-copy" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .8, ease: [0.22, 1, .36, 1] }}>
          <p className="eyebrow"><span className="eyebrow-line" /> A LITTLE ARCHIVE OF US</p>
          <h1>All my days<br />lead back <em>to you.</em></h1>
          <p className="opening-note">For the ordinary Tuesdays, the almost-forgotten details, and every beautiful thing still ahead.</p>
          <a className="text-link" href="#moments">Wander through <ArrowDown size={15} /></a>
        </motion.div>
        <motion.div className="opening-photo photo-frame" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, delay: .15 }}>
          <img src={memories[0]?.imageUrl ?? 'https://images.unsplash.com/photo-1516589178581-6cd7833ae3b2?auto=format&fit=crop&w=1800&q=90'} alt={memories[0]?.imageAlt ?? 'Two people together at sunset'} />
          <span className="photo-index">01 / THE BEGINNING, AGAIN</span><span className="photo-stamp"><Heart size={18} fill="currentColor" /></span>
        </motion.div>
        <div className="opening-side-note">MADE OF LITTLE THINGS <span>✳</span> KEPT WITH LOVE</div>
      </section>

      <section className="letter-band section-wrap" id="letters">
        <div className="section-heading"><div><p className="eyebrow">01 — WORDS I KEEP MEANING</p><h2>Letters to <em>you</em></h2></div><span className="heading-aside">Written slowly. Meant forever.</span></div>
        <div className="letter-grid">{letters.map((entry, index) => <motion.article className="letter-card" key={entry.id} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .2 }} transition={{ duration: .65, delay: index * .12 }}><span className="letter-number">A LETTER {String(index + 1).padStart(2, '0')}</span><h3>{entry.title}</h3><p>{entry.body}</p><span className="letter-date">{entry.date}</span></motion.article>)}{!letters.length && <p className="empty-note">The next letter is waiting to be written.</p>}</div>
      </section>

      <section className="correspondence section-wrap">
        <div className="section-heading"><div><p className="eyebrow">A PAGE LEFT OPEN</p><h2>Write <em>back</em></h2></div><span className="heading-aside">The sweetest conversations are the ones we keep.</span></div>
        <div className="correspondence-grid">{letters.map((letter) => <article className="correspondence-card" key={`thread-${letter.id}`}>
          <div className="correspondence-original"><span className="letter-number">IN REPLY TO</span><h3>{letter.title}</h3></div>
          {entries.filter((entry) => entry.kind === 'reply' && entry.replyTo === letter.id).map((reply) => <div className="reply-slip" key={reply.id}><span className="reply-byline">{reply.author || 'A note from us'} · {reply.date}</span><p>{reply.body}</p></div>)}
          <button className="reply-button" type="button" onClick={() => openReply(letter)}>Write a little reply <ArrowRight size={15} /></button>
        </article>)}</div>
        {!letters.length && <p className="empty-note">A letter will find its way here when one is written.</p>}
      </section>

      <section className="diary-band" id="diary">
        <div className="diary-inner section-wrap"><div className="diary-heading"><p className="eyebrow">02 — THE THINGS I ALMOST DIDN'T SAY</p><h2>Diary <em>confessions</em></h2><p className="diary-intro">Little truths from the margins of our days.</p></div>
          <div className="diary-list">{diary.map((entry, index) => <motion.article className="diary-entry" key={entry.id} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .25 }} transition={{ duration: .6, delay: index * .12 }}><span className="diary-date">{entry.date}</span><div><h3>{entry.title}</h3><p>{entry.body}</p></div><span className="diary-heart"><Heart size={18} /></span></motion.article>)}{!diary.length && <p className="empty-note">A quiet page, for now.</p>}</div>
        </div><span className="diary-doodle" aria-hidden="true">♡</span>
      </section>

      <section className="moments-section section-wrap" id="moments">
        <div className="section-heading moments-heading"><div><p className="eyebrow">03 — PROOF OF ALL THIS JOY</p><h2>Our little <em>moments</em></h2></div><p className="heading-aside">A thousand small reasons<br />to choose you, every day.</p></div>
        <div className="gallery-grid">{memories.map((entry, index) => <motion.button type="button" className={`gallery-item gallery-item-${index % 3}`} key={entry.id} onClick={() => setActivePhoto(entry)} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .15 }} transition={{ duration: .7, delay: (index % 3) * .1 }}><span className="gallery-image"><img src={entry.imageUrl} alt={entry.imageAlt ?? entry.title} loading="lazy" /><span className="gallery-open"><ArrowUpRight size={18} /></span></span><span className="gallery-meta"><span><span className="gallery-date">{entry.date}</span><span className="gallery-title">{entry.title}</span></span><ArrowUpRight size={16} /></span></motion.button>)}{!memories.length && <p className="empty-note">Our first photo belongs here.</p>}</div>
        <div className="gallery-endnote"><span>AND THIS IS ONLY THE BEGINNING</span><Heart size={15} fill="currentColor" /><span>MORE MEMORIES TO COME</span></div>
      </section>
      <section className="closing-note"><span className="closing-star">✳</span><p>In every version of the story,<br /><em>I’d still find my way to you.</em></p><span className="closing-sign">Yours, in all the little ways</span></section>
    </main>

    <footer className="footer"><a className="wordmark" href="#home"><span className="brand-mark"><Heart size={13} fill="currentColor" /></span>our, always</a><span>MADE FOR TWO, WITH LOVE</span><a href="#home" className="back-top">BACK TO THE BEGINNING <ArrowUpRight size={13} /></a></footer>
    <NotebookComposer open={editorOpen} mode={composerMode} replyTitle={replyTarget?.title} busy={busy} error={authError} onClose={closeComposer} onSubmit={handleCreateEntry} />

    <AnimatePresence>{activePhoto && <motion.div className="lightbox" role="dialog" aria-modal="true" aria-label={activePhoto.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setActivePhoto(null)} onKeyDown={(event) => { if (event.key === 'Escape') setActivePhoto(null) }}>
      <button className="lightbox-close" type="button" aria-label="Close photo" onClick={() => setActivePhoto(null)}><X size={21} /></button>
      <button className="lightbox-prev" type="button" aria-label="Previous photo" onClick={(event) => { event.stopPropagation(); const index = memories.findIndex((entry) => entry.id === activePhoto.id); setActivePhoto(memories[(index - 1 + memories.length) % memories.length]) }}><ArrowLeft size={20} /></button>
      <motion.figure className="lightbox-figure" initial={{ scale: .94, y: 18 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .96 }} onClick={(event) => event.stopPropagation()}><img src={activePhoto.imageUrl} alt={activePhoto.imageAlt ?? activePhoto.title} /><figcaption><span>{activePhoto.date}</span><h2>{activePhoto.title}</h2><p>{activePhoto.body}</p></figcaption></motion.figure>
      <button className="lightbox-next" type="button" aria-label="Next photo" onClick={(event) => { event.stopPropagation(); const index = memories.findIndex((entry) => entry.id === activePhoto.id); setActivePhoto(memories[(index + 1) % memories.length]) }}><ArrowRight size={20} /></button>
    </motion.div>}</AnimatePresence>
  </div>
}

export default Site