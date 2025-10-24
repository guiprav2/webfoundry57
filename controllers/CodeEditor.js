import rfiles from '../repos/rfiles.js';
import { debounce, isMedia } from '../other/util.js';
import { mountLighted } from '../other/lighted.js';
import { createYjsBackend } from '../components/CodeEditor.js';
import { lookup as mimeLookup } from 'https://esm.sh/mrmime';

const FALLBACK_CURSOR_COLOR = 'sky-500';
const CURSOR_BROADCAST_MIN_INTERVAL = 50;

export default class CodeEditor {
  state = {
    target(path) { return (path && !isMedia(path) && !(/^components\/|pages\//.test(path) && path.endsWith('.html'))) },
    editorHandle: null,
    yBackend: null,
    changeHandler: null,
    currentPath: null,
    currentProject: null,
    pendingSelection: null,
    ready: false,
    selectionHandler: null,
    remoteCursorMarkers: new Map(),
    cursorRTC: null,
    cursorRTCHandler: null,
    lastCursorBroadcast: 0,
    cursorBroadcastTimeout: null,
    presenceListener: null,
    vimBinding: null,
  };

  peerClassCache = new Map();
  colorCache = new Map();

  getPeerClass = peer => {
    if (!peer) return 'peer-unknown';
    if (this.peerClassCache.has(peer)) return this.peerClassCache.get(peer);
    let sanitized = `peer-${peer}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!/^[a-zA-Z_]/.test(sanitized)) sanitized = `peer-${sanitized}`;
    this.peerClassCache.set(peer, sanitized);
    return sanitized;
  };

  reflowRemoteCursors = () => {
    if (!this.state.remoteCursorMarkers.size) return;
    let entries = Array.from(this.state.remoteCursorMarkers.entries());
    for (let [peer, data] of entries) {
      if (!data?.ranges?.length) continue;
      this.renderRemoteCursor(peer, data.ranges);
    }
  };

  updateEditorFontSize = size => {
    let doc = this.state.editorHandle?.doc;
    if (!doc?.textarea) return;
    let value = typeof size === 'number' ? `${size}px` : size || '16px';
    doc.textarea.style.fontSize = value;
    doc.refreshMetrics?.();
    doc.requestMeasure?.();
    this.reflowRemoteCursors();
  };

  updateEditorTabSize = size => {
    let doc = this.state.editorHandle?.doc;
    if (!doc?.textarea) return;
    let tabSize = Number(size) || 2;
    doc.config = doc.config || {};
    doc.config.tabSize = tabSize;
    doc.tabString = ' '.repeat(Math.max(1, tabSize));
    doc.textarea.style.tabSize = String(tabSize);
    if (doc.overlayPre) doc.overlayPre.style.tabSize = String(tabSize);
    doc.refresh?.();
    doc.requestMeasure?.();
    this.reflowRemoteCursors();
  };

  setEditorTheme = async theme => {
    let doc = this.state.editorHandle?.doc;
    if (!doc?.container) return;
    let value = theme || '';
    doc.container.dataset.codeTheme = value;
  };

  setEditorKeyMap = async keyMap => {
    let doc = this.state.editorHandle?.doc;
    if (!doc?.textarea) return;
    let mode = keyMap ? String(keyMap).toLowerCase() : 'default';
    if (mode !== 'vim') {
      if (this.state.vimBinding) {
        try {
          this.state.vimBinding.remove?.();
        } catch (err) {
          console.warn('Failed to release Vim binding', err);
        }
        this.state.vimBinding = null;
      }
      return;
    }
    if (this.state.vimBinding) return;
    try {
      let mod = await import('../other/textarea-vim.js');
      let VimClass = mod?.Vim;
      if (!VimClass) return;
      let textarea = doc.textarea;
      let listeners = [];
      let originalAdd = textarea.addEventListener;
      textarea.addEventListener = function (type, handler, options) {
        if ((type === 'keydown' || type === 'keyup') && handler) {
          listeners.push({ type, handler, options });
        }
        return originalAdd.call(this, type, handler, options);
      };
      let vimInstance;
      try {
        vimInstance = new VimClass(textarea, document.createElement('div'), document.createElement('div'), document.createElement('div'));
      } finally {
        textarea.addEventListener = originalAdd;
      }
      this.state.vimBinding = {
        instance: vimInstance,
        remove: () => {
          for (let entry of listeners) {
            try {
              textarea.removeEventListener(entry.type, entry.handler, entry.options);
            } catch {}
          }
          listeners.length = 0;
        },
      };
    } catch (err) {
      console.warn('Failed to enable Vim mode', err);
    }
  };

  getPeerColor = peer => state.collab.rtc?.presence?.find?.(x => x.user === peer)?.color || null;

  resolveColor = name => {
    let key = name || FALLBACK_CURSOR_COLOR;
    if (this.colorCache.has(key)) return this.colorCache.get(key);
    let probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    probe.style.pointerEvents = 'none';
    probe.className = `bg-${key}`;
    document.body.append(probe);
    let computed = window.getComputedStyle(probe).backgroundColor;
    probe.remove();
    let match = computed && computed.match(/\d+\.?\d*/g);
    let rgb = { r: 125, g: 211, b: 252 };
    if (match && match.length >= 3) {
      rgb = { r: Number(match[0]), g: Number(match[1]), b: Number(match[2]) };
    }
    this.colorCache.set(key, rgb);
    return rgb;
  };

  attachCursorRTC = rtc => {
    if (this.state.cursorRTC === rtc) return;
    this.detachCursorRTC();
    if (!rtc?.events) return;
    this.state.cursorRTCHandler ??= message => this.handleRemoteCursorMessage(message);
    this.state.cursorRTC = rtc;
    rtc.events.on('codeEditor:cursor', this.state.cursorRTCHandler);
  };

  detachCursorRTC = () => {
    if (!this.state.cursorRTC) return;
    try {
      this.state.cursorRTC.events.off('codeEditor:cursor', this.state.cursorRTCHandler);
    } catch {}
    this.state.cursorRTC = null;
  };

  handleRemoteCursorMessage = message => {
    if (!message || message.peer === state.collab.uid) return;
    if (message.project !== this.state.currentProject) {
      this.clearRemoteCursor(message.peer);
      return;
    }
    if (message.path !== this.state.currentPath) {
      this.clearRemoteCursor(message.peer);
      return;
    }
    if (!Array.isArray(message.ranges)) {
      this.clearRemoteCursor(message.peer);
      return;
    }
    if (!this.state.editorHandle?.doc) return;
    this.renderRemoteCursor(message.peer, message.ranges);
  };

  broadcastCursor = (force = false) => {
    let doc = this.state.editorHandle?.doc;
    let rtc = state.collab.rtc;
    if (!doc || !rtc || !this.state.currentProject || !this.state.currentPath) return;
    if (typeof doc.listSelections !== 'function') return;
    let now = performance.now();
    let elapsed = now - this.state.lastCursorBroadcast;
    if (!force && elapsed < CURSOR_BROADCAST_MIN_INTERVAL) {
      if (!this.state.cursorBroadcastTimeout) {
        let delay = Math.max(0, CURSOR_BROADCAST_MIN_INTERVAL - elapsed);
        this.state.cursorBroadcastTimeout = setTimeout(() => {
          this.state.cursorBroadcastTimeout = null;
          this.broadcastCursor(true);
        }, delay);
      }
      return;
    }
    if (this.state.cursorBroadcastTimeout) {
      clearTimeout(this.state.cursorBroadcastTimeout);
      this.state.cursorBroadcastTimeout = null;
    }
    this.state.lastCursorBroadcast = now;
    let ranges = doc.listSelections().map(sel => ({
      anchor: { line: sel.anchor.line, ch: sel.anchor.ch },
      head: { line: sel.head.line, ch: sel.head.ch },
    }));
    try {
      rtc.send({
        type: 'codeEditor:cursor',
        project: this.state.currentProject,
        path: this.state.currentPath,
        ranges,
      });
    } catch (err) {
      console.error('CodeEditor cursor broadcast error', err);
    }
  };

  clearRemoteCursor = peer => {
    let data = this.state.remoteCursorMarkers.get(peer);
    if (!data) return;
    for (let node of data.selections || []) {
      try {
        node.remove();
      } catch {}
    }
    for (let node of data.cursors || []) {
      try {
        node.remove();
      } catch {}
    }
    this.state.remoteCursorMarkers.delete(peer);
  };

  clearAllRemoteCursors = () => {
    for (let peer of [...this.state.remoteCursorMarkers.keys()]) this.clearRemoteCursor(peer);
    this.state.remoteCursorMarkers.clear();
  };

  renderRemoteCursor = (peer, ranges = []) => {
    let lightedDoc = this.state.editorHandle?.doc;
    if (!lightedDoc) return;
    let overlay = lightedDoc.overlayDecor;
    if (!overlay) return;
    let metrics = lightedDoc.metrics || {};
    if (!metrics.charWidth || metrics.charWidth <= 0) {
      lightedDoc.requestMeasure();
      metrics = lightedDoc.metrics || {};
    }
    let charWidth = metrics.charWidth && metrics.charWidth > 0 ? metrics.charWidth : 8;
    let lineHeight = metrics.lineHeight && metrics.lineHeight > 0 ? metrics.lineHeight : 16;
    let paddingTop = metrics.paddingTop || 0;
    let paddingLeft = metrics.paddingLeft || 0;
    let lines = lightedDoc.lines || [];
    this.clearRemoteCursor(peer);
    if (!Array.isArray(ranges) || !ranges.length) return;
    let ownerDoc = overlay.ownerDocument || document;
    let selectionNodes = [];
    let cursorNodes = [];
    let peerCls = this.getPeerClass(peer);
    let storedRanges = [];
    for (let range of ranges) {
      if (!range) continue;
      let anchor = lightedDoc.clipPos?.(range.anchor || {}) || { line: range.anchor?.line || 0, ch: range.anchor?.ch || 0 };
      let head = lightedDoc.clipPos?.(range.head || {}) || { line: range.head?.line || 0, ch: range.head?.ch || 0 };
      let anchorIndex = lightedDoc.indexFromPos ? lightedDoc.indexFromPos(anchor) : null;
      let headIndex = lightedDoc.indexFromPos ? lightedDoc.indexFromPos(head) : null;
      if (anchorIndex == null || headIndex == null) continue;
      let from = anchorIndex <= headIndex ? anchor : head;
      let to = anchorIndex <= headIndex ? head : anchor;
      if (anchorIndex !== headIndex) {
        let startLine = from.line || 0;
        let endLine = to.line || 0;
        for (let line = startLine; line <= endLine; line += 1) {
          let lineText = lines[line] || '';
          let segmentStart = line === startLine ? (from.ch || 0) : 0;
          let segmentEnd = line === endLine ? (to.ch || 0) : lineText.length;
          if (segmentEnd < segmentStart) {
            let tmp = segmentStart;
            segmentStart = segmentEnd;
            segmentEnd = tmp;
          }
          if (segmentStart === segmentEnd) continue;
          let width = Math.max(charWidth * 0.1, (segmentEnd - segmentStart) * charWidth);
          let left = paddingLeft + segmentStart * charWidth;
          let top = paddingTop + line * lineHeight;
          let node = ownerDoc.createElement('div');
          let selectionClass = `Lighted-remote-selection ${peerCls ? `Lighted-remote-selection-${peerCls}` : ''}`.trim();
          node.className = `remote-selection ${selectionClass}`.trim();
          node.dataset.peer = peer;
          node.style.left = `${left}px`;
          node.style.top = `${top}px`;
          node.style.width = `${width}px`;
          node.style.height = `${lineHeight}px`;
          node.style.pointerEvents = 'none';
          node.style.boxSizing = 'border-box';
          overlay.appendChild(node);
          selectionNodes.push(node);
        }
      }
      let cursorNode = ownerDoc.createElement('div');
      let cursorClass = `Lighted-remote-cursor ${peerCls ? `Lighted-remote-cursor-${peerCls}` : ''}`.trim();
      cursorNode.className = `remote-cursor ${cursorClass}`.trim();
      cursorNode.dataset.peer = peer;
      let cursorTop = paddingTop + (head.line || 0) * lineHeight;
      let cursorLeft = paddingLeft + (head.ch || 0) * charWidth;
      cursorNode.style.left = `${cursorLeft}px`;
      cursorNode.style.top = `${cursorTop}px`;
      cursorNode.style.height = `${lineHeight}px`;
      cursorNode.style.borderLeftWidth = cursorNode.style.borderLeftWidth || '2px';
      cursorNode.style.borderLeftStyle = cursorNode.style.borderLeftStyle || 'solid';
      cursorNode.style.marginLeft = '-1px';
      cursorNode.style.pointerEvents = 'none';
      cursorNode.style.boxSizing = 'border-box';
      overlay.appendChild(cursorNode);
      cursorNodes.push(cursorNode);
      storedRanges.push({
        anchor: { line: anchor.line || 0, ch: anchor.ch || 0 },
        head: { line: head.line || 0, ch: head.ch || 0 }
      });
    }
    if (!selectionNodes.length && !cursorNodes.length) {
      return;
    }
    this.state.remoteCursorMarkers.set(peer, { selections: selectionNodes, cursors: cursorNodes, ranges: storedRanges });
    this.applyRemoteCursorColor(peer, this.getPeerColor(peer) || FALLBACK_CURSOR_COLOR);
  };

  applyRemoteCursorColor = (peer, color) => {
    let overlay = this.state.editorHandle?.doc?.overlayDecor;
    if (!overlay) return;
    let peerCls = this.getPeerClass(peer);
    let selectionNodes = overlay.querySelectorAll(`.Lighted-remote-selection-${peerCls}`);
    let cursorNodes = overlay.querySelectorAll(`.Lighted-remote-cursor-${peerCls}`);
    let selectionColor = color || FALLBACK_CURSOR_COLOR;
    let rgb = this.resolveColor(selectionColor);
    for (let node of selectionNodes) {
      node.dataset.peer = peer;
      node.style.backgroundColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.3)`;
      node.style.borderRadius = node.style.borderRadius || '3px';
    }
    for (let node of cursorNodes) {
      node.dataset.peer = peer;
      node.style.borderLeftColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      node.style.borderLeftWidth = node.style.borderLeftWidth || '2px';
      node.style.borderLeftStyle = node.style.borderLeftStyle || 'solid';
      node.style.marginLeft = node.style.marginLeft || '-1px';
      node.style.pointerEvents = 'none';
      node.style.width = node.style.width || '0px';
      node.style.display = node.style.display || 'inline-block';
      node.style.boxSizing = node.style.boxSizing || 'border-box';
      node.style.opacity = node.style.opacity || '0.9';
    }
  };

  refreshRemoteCursorColors = () => {
    if (!this.state.remoteCursorMarkers.size) return;
    let entries = Array.from(this.state.remoteCursorMarkers.entries());
    for (let [peer, data] of entries) {
      if (!data?.ranges?.length) continue;
      this.renderRemoteCursor(peer, data.ranges);
    }
  };

  removeStaleRemoteCursors = () => {
    if (!this.state.remoteCursorMarkers.size) return;
    let active = new Set(state.collab.rtc?.presence?.map?.(x => x.user) || []);
    for (let peer of [...this.state.remoteCursorMarkers.keys()]) {
      if (peer === state.collab.uid) continue;
      if (!active.has(peer)) this.clearRemoteCursor(peer);
    }
  };

  handlePresenceUpdate = () => {
    this.attachCursorRTC(state.collab.rtc);
    this.removeStaleRemoteCursors();
    this.refreshRemoteCursorColors();
    this.broadcastCursor(true);
  };

  actions = {
    init: () => {
      let { bus } = state.event;
      if (!document.getElementById('LightedEditorStyles')) {
        document.head.append(d.el('style', { id: 'LightedEditorStyles' }, `
          .lighted { height: 100%; background-color: #04060960; display: flex; flex-direction: row; }
          .lighted-pane { flex: 1 1 auto; position: relative; }
          .lighted-input { font-family: inherit; background-color: transparent; color: transparent; caret-color: var(--lighted-caret); outline: none; }
          .lighted .decor-layer .remote-selection { border-radius: 4px; opacity: 0.75; }
          .lighted .decor-layer .remote-cursor { border-left-width: 2px; border-left-style: solid; opacity: 0.9; }
        `));
      }
      this.attachCursorRTC(state.collab.rtc);
      if (!this.state.presenceListener) {
        this.state.presenceListener = () => this.handlePresenceUpdate();
        bus.on('collab:presence:update', this.state.presenceListener);
      }
      bus.on('files:select:ready', async ({ project, path }) => await post('codeEditor.open'));
      bus.on('collab:apply:ready', async () => {
        if (state.collab.uid === 'master') return;
        if (!state.files.current) return;
        await post('codeEditor.open');
      });
      this.state.ready = true;
      if (this.state.pendingSelection) {
        this.state.pendingSelection = null;
        queueMicrotask(() => this.actions.open());
      }
      bus.emit('codeEditor:init:ready');
      bus.on('settings:global:option:ready', async ({ k, v }) => {
        switch (k) {
          case 'vim':
            await this.setEditorKeyMap(v ? 'vim' : 'default');
            break;
          case 'codeTheme': {
            let theme = v || state.settings.opt.codeTheme || 'monokai';
            await this.setEditorTheme(theme);
            break;
          }
          case 'codeFontSize': {
            let size = state.settings.opt.codeFontSize || v || '16px';
            this.updateEditorFontSize(size);
            break;
          }
          case 'codeTabSize': {
            let size = Number(v ?? state.settings.opt.codeTabSize) || 2;
            this.updateEditorTabSize(size);
            break;
          }
          default:
            break;
        }
      });
    },

    open: async () => {
      let project = state.projects.current;
      let path = state.files.current;
      if (!path) return await post('codeEditor.reset');
      if (!this.state.target(path)) return;
      let type = mimeLookup(path);
      if (!type?.startsWith?.('text/') || type === 'text/html') return;
      if (this.state.currentPath === path) return;
      if (!this.state.ready) {
        this.state.pendingSelection = true;
        return;
      }
      await post('codeEditor.reset');
      d.updateSync();
      let wrapper = document.querySelector('#CodeEditor');
      if (!wrapper) return;
      let el = d.el('div', {
        class: 'flex-1',
        style: {
          width: () => `${innerWidth - wrapper.getBoundingClientRect().left}px`,
          height: () => `${innerHeight - wrapper.getBoundingClientRect().top}px`,
        },
      });
      wrapper.replaceChildren(el);
      let tabSize = state.settings.opt.codeTabSize || 2;
      let lightedDoc = mountLighted(el, {
        value: '',
        tabSize,
        convertTabsToSpaces: true,
        autoIndent: true,
        showGutter: true,
        relativeLineNumbers: true,
      });
      if (!lightedDoc) return;
      lightedDoc.container.classList.add('w-full', 'h-full');
      if (typeof lightedDoc.refresh === 'function') {
        let originalRefresh = lightedDoc.refresh.bind(lightedDoc);
        lightedDoc.refresh = (...args) => {
          let result = originalRefresh(...args);
          this.reflowRemoteCursors();
          return result;
        };
      }
      if (typeof lightedDoc.setValue === 'function') {
        let originalSetValue = lightedDoc.setValue.bind(lightedDoc);
        lightedDoc.setValue = (...args) => {
          let result = originalSetValue(...args);
          this.reflowRemoteCursors();
          return result;
        };
      }
      if (typeof lightedDoc.refreshMetrics === 'function') {
        let originalRefreshMetrics = lightedDoc.refreshMetrics.bind(lightedDoc);
        lightedDoc.refreshMetrics = (...args) => {
          let result = originalRefreshMetrics(...args);
          this.reflowRemoteCursors();
          return result;
        };
      }
      if (typeof lightedDoc.requestMeasure === 'function') {
        let originalRequestMeasure = lightedDoc.requestMeasure.bind(lightedDoc);
        lightedDoc.requestMeasure = (...args) => {
          let result = originalRequestMeasure(...args);
          requestAnimationFrame(() => this.reflowRemoteCursors());
          return result;
        };
      }
      this.state.editorHandle = {
        doc: lightedDoc,
        destroy: () => {
          lightedDoc.destroy();
        },
      };
      this.state.currentPath = path;
      this.state.currentProject = project;
      let initialText = '';
      if (state.collab.uid === 'master') {
        let blob = await rfiles.load(project, path);
        initialText = blob ? await blob.text() : '';
      }
      this.state.yBackend?.destroy?.();
      this.state.yBackend = await createYjsBackend({
        doc: lightedDoc,
        project,
        path,
        initialValue: initialText,
        clientId: state.collab.uid,
        isMaster: state.collab.uid === 'master',
        getRTC: () => state.collab.rtc,
        bus: state.event?.bus,
      });
      lightedDoc.refreshMetrics();
      lightedDoc.requestMeasure();
      this.updateEditorTabSize(tabSize);
      this.updateEditorFontSize(state.settings.opt.codeFontSize || '16px');
      await this.setEditorKeyMap(state.settings.opt.vim ? 'vim' : 'default');
      await this.setEditorTheme(state.settings.opt.codeTheme || 'monokai');
      let changeHandler = async () => {
        if (!this.state.editorHandle?.doc) return;
        this.reflowRemoteCursors();
        if (state.collab.uid !== 'master') return;
        await post('codeEditor.change');
      };
      lightedDoc.textarea.addEventListener('input', changeHandler);
      this.state.changeHandler = changeHandler;
      let selectionHandler = () => {
        queueMicrotask(() => {
          this.broadcastCursor();
        });
      };
      lightedDoc.textarea.addEventListener('select', selectionHandler);
      lightedDoc.textarea.addEventListener('keyup', selectionHandler);
      lightedDoc.textarea.addEventListener('mouseup', selectionHandler);
      this.state.selectionHandler = selectionHandler;
      this.attachCursorRTC(state.collab.rtc);
      this.broadcastCursor(true);
      this.reflowRemoteCursors();
      lightedDoc.focus();
    },

    reset: async () => {
      let textarea = this.state.editorHandle?.doc?.textarea;
      if (textarea && this.state.changeHandler) {
        textarea.removeEventListener('input', this.state.changeHandler);
      }
      if (textarea && this.state.selectionHandler) {
        textarea.removeEventListener('select', this.state.selectionHandler);
        textarea.removeEventListener('keyup', this.state.selectionHandler);
        textarea.removeEventListener('mouseup', this.state.selectionHandler);
      }
      if (this.state.cursorBroadcastTimeout) {
        clearTimeout(this.state.cursorBroadcastTimeout);
        this.state.cursorBroadcastTimeout = null;
      }
      if (state.collab.rtc && this.state.currentProject && this.state.currentPath) {
        try {
          await state.collab.rtc.send({
            type: 'codeEditor:cursor',
            project: this.state.currentProject,
            path: this.state.currentPath,
            ranges: [],
          });
        } catch (err) {
          console.error('CodeEditor cursor broadcast error', err);
        }
      }
      this.clearAllRemoteCursors();
      this.state.yBackend?.destroy?.();
      this.state.yBackend = null;
      if (this.state.vimBinding) {
        try {
          this.state.vimBinding.remove?.();
        } catch {}
        this.state.vimBinding = null;
      }
      this.state.editorHandle?.destroy?.();
      this.state.editorHandle = null;
      this.state.changeHandler = null;
      this.state.selectionHandler = null;
      this.state.lastCursorBroadcast = 0;
      this.state.currentPath = null;
      this.state.currentProject = null;
      let wrapper = document.querySelector('#CodeEditor');
      if (wrapper) wrapper.innerHTML = '';
    },

    change: debounce(async () => {
      if (!this.state.editorHandle?.doc || !state.files.current) return;
      let type = mimeLookup(state.files.current);
      let value = this.state.editorHandle.doc.getValue?.() ?? '';
      await rfiles.save(state.projects.current, state.files.current, new Blob([value], { type }));
    }, 200),
  };
}
