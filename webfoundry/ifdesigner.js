import BiMap from './bimap.js';
import Boo from 'https://esm.sh/@camilaprav/boo@1.0.6';
import d from './dominant.js';
import htmlsnap from 'https://esm.sh/@camilaprav/htmlsnap@0.0.14';
import morphdom from 'https://esm.sh/morphdom';

window.state = { map: new BiMap(), cursors: {}, overlays: {} };
let wforigin = `${location.protocol}//${location.hostname.split('.').slice(1).join('.')}`;
addEventListener('message', async ev => {
  let { type, ...rest } = ev.data;
  if (type !== 'state' || ev.origin !== wforigin) return;
  Object.assign(state, rest);
});
addEventListener('message', async ev => {
  if (ev.data.type !== 'update' || ev.origin !== wforigin) return;
  morphdom(document.documentElement, ev.data.html);
});
addEventListener('message', async ev => {
  if (ev.data.type !== 'eval' || ev.origin !== wforigin) return;
  try {
    let AsyncFunction = (async () => {}).constructor;
    let fn = new AsyncFunction('state', 'args', ev.data.fn);
    parent.postMessage({ type: 'eval:res', rpcid: ev.data.rpcid, result: await fn(state, ev.data.args) }, wforigin);
  } catch (err) {
    console.error(err);
    parent.postMessage({ type: 'eval:res', rpcid: ev.data.rpcid, error: err.toString() }, wforigin);
  }
});
addEventListener('mousedown', async ev => {
  document.activeElement.blur();
  ev.preventDefault();
  if (!ev.shiftKey) parent.postMessage({ type: 'action', key: 'changeSelection', cur: state.collab.uid, s: [state.map.getKey(ev.target)] }, wforigin);
  else parent.postMessage({ type: 'action', key: 'changeSelection', cur: state.collab.uid, s: [...new Set([...state.cursors[state.collab.uid] || [], state.map.getKey(ev.target)])] }, wforigin);
});
addEventListener('keydown', ev => parent.postMessage({ type: 'keydown', key: ev.key, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey }, wforigin));
async function trackCursors() {
  requestAnimationFrame(async () => await trackCursors());
  if (!document.body) return; // document.open
  for (let [k, ids] of Object.entries(state.cursors)) {
    let ovs = (state.overlays[k] ??= []);
    while (ids.length > ovs.length) {
      let i = ovs.length;
      let p = state.collab.rtc?.presence?.find?.(x => x.user === k);
      let o = d.el('div', { class: ['wf-cursor hidden border z-10 pointer-events-none', () => !p ? 'border-blue-400' : `border-${p.color}`] });
      ovs.push(new Boo(o, () => state.map.get(state.cursors[k][i]), { transitionClass: 'transition-all' }));
    }
    while (ovs.length > ids.length) ovs.pop().disable();
    for (let x of ovs) !x.ov.parentElement && document.body.append(x.ov);
  }
}
await trackCursors();
let snap = () => {
  let [snap, map] = htmlsnap(document.documentElement, { idtrack: true, map: state.map });
  state.map = map;
  let doc = new DOMParser().parseFromString(snap, 'text/html');
  doc.querySelectorAll('.wf-cursor').forEach(x => x.remove());
  if (doc.documentElement.outerHTML === state.snap) return;
  snap = state.snap = doc.documentElement.outerHTML;
  parent.postMessage({ type: 'htmlsnap', snap }, wforigin);
};
let mutobs = new MutationObserver(snap);
mutobs.observe(document, { attributes: true, subtree: true, childList: true, characterData: true });
snap();
parent.postMessage({ type: 'ready', status: 200 }, wforigin);
