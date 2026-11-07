import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Heart, X } from 'lucide-react'
import type { FormEvent } from 'react'

type Props = {
  open: boolean
  mode: 'entry' | 'reply'
  replyTitle?: string
  busy: boolean
  error: string
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

function localDateValue() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function NotebookComposer({ open, mode, replyTitle, busy, error, onClose, onSubmit }: Props) {
  return <AnimatePresence>
    {open && <motion.div className="notebook-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.form className="notebook-panel" onSubmit={onSubmit} initial={{ x: 28, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 18, opacity: 0 }} onClick={(event) => event.stopPropagation()}>
        <button className="notebook-close" type="button" aria-label="Close note" onClick={onClose}><X size={19} /></button>
        <div className="notebook-topline"><span>{mode === 'reply' ? 'A PAGE BACK TO YOU' : 'A NEW PAGE IN OUR STORY'}</span><Heart size={16} /></div>
        <h2 className="notebook-title">{mode === 'reply' ? <>Write <em>back</em></> : <>Dear you, <em>today</em></>}</h2>
        {mode === 'reply' && <p className="notebook-context">In reply to <strong>{replyTitle}</strong></p>}
        {mode === 'entry' && <>
          <label className="notebook-control">THIS PAGE IS A<select name="kind" required><option value="letter">Love letter</option><option value="diary">Diary confession</option><option value="memory">Photo memory</option></select></label>
          <label className="notebook-control">A LITTLE TITLE<input name="title" maxLength={120} required placeholder="For the days you forget" /></label>
        </>}
        <label className="notebook-control note-body-label">{mode === 'reply' ? 'YOUR REPLY' : 'THE WORDS I WANT TO KEEP'}<textarea className="handwriting" name="body" required maxLength={5000} rows={7} autoFocus placeholder={mode === 'reply' ? 'I read your words, and...' : 'I’ve been meaning to tell you...'} /></label>
        <div className="notebook-details">
          {mode === 'reply' ? <p className="notebook-date-stamp">DATED ON THE DAY YOU SAVE IT</p> : <label className="notebook-control">DATE<input name="date" type="date" defaultValue={localDateValue()} required /></label>}
          {mode === 'entry' && <label className="notebook-control photo-control">TUCK IN A PHOTO<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /><span>JPG, PNG or WebP · up to 10 MB</span></label>}
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-dark notebook-save" type="submit" disabled={busy}>{busy ? 'Keeping your words…' : 'Save this page'}<ArrowRight size={16} /></button>
        <p className="notebook-footnote">A little note, kept between us <Heart size={12} /></p>
      </motion.form>
    </motion.div>}
  </AnimatePresence>
}