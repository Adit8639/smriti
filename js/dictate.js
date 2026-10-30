// Dictation through the browser's speech recognition, when the device offers it. Chrome on
// Android can work offline with downloaded voices; elsewhere it may need a connection.

import { h, toast } from './ui.js';
import { app } from './store.js';

export function dictation(onText, { short = false } = {}) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const btn = h('button', { class: 'btn mic', type: 'button', 'aria-pressed': 'false' }, 'Dictate');
  let rec = null;
  btn.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    try {
      rec = new SR();
    } catch (e) {
      toast('Dictation is not available here.', { kind: 'warn' });
      return;
    }
    rec.lang = app.state.settings.dictationLang || 'en-IN';
    rec.interimResults = false;
    rec.continuous = !short;
    rec.onresult = (e) => {
      const text = [...e.results].slice(e.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript).join(' ').trim();
      if (text) onText(text);
    };
    rec.onerror = (e) => {
      const msg = { network: 'Dictation needs a connection on this device.', 'not-allowed': 'Microphone permission was denied.', 'no-speech': 'No speech heard.', 'language-not-supported': 'This language is not available for dictation.' }[e.error] || `Dictation stopped (${e.error}).`;
      toast(msg, { kind: 'warn' });
    };
    rec.onend = () => {
      rec = null;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = 'Dictate';
    };
    try {
      rec.start();
      btn.setAttribute('aria-pressed', 'true');
      btn.textContent = 'Stop dictating';
    } catch (e) {
      rec = null;
      toast(`Dictation could not start: ${e.message}`, { kind: 'warn' });
    }
  });
  return btn;
}
