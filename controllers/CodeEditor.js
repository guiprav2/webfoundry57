import { isMedia } from '../other/util.js';
import { mountCodeMirror } from '../other/codemirror.js';
import rfiles from '../repos/rfiles.js';
import { lookup as mimeLookup } from 'https://cdn.skypack.dev/mrmime';

export default class CodeEditor {
  state = {
    target(path) {
      let isHtmlTemplate = ((/^components\//.test(path) || /^pages\//.test(path)) && path.endsWith('.html'));
      return path && !isMedia(path) && !isHtmlTemplate;
    },
    ready: false,
    pendingOpen: false,
    currentProject: null,
    currentPath: null,
    hostElement: null,
    placeholderElement: null,
    editorMount: null,
    editorContainer: null,
    vimToggle: null,
    saveButton: null,
    revertButton: null,
    pathLabel: null,
    statusEl: null,
    currentValue: '',
    initialValue: '',
    dirty: false,
    loading: false,
    saving: false,
    externalChange: false,
    handlersAttached: false,
    busSubscribed: false,
    fallbackTextarea: null,
    statusMessage: '',
    statusTone: 'muted',
    recentSaveAt: 0,
  };

  renderPlaceholder = message => {
    let wrapper = document.querySelector('#CodeEditor');
    if (!wrapper) {
      return null;
    }
    this.destroyEditorUI();
    if (!this.state.placeholderElement) {
      let placeholder = d.el('div', {
        class: 'CodeEditor-placeholder flex flex-1 items-center justify-center rounded-md border border-slate-800/60 bg-slate-950/70 p-6 text-center text-sm italic text-slate-300',
      });
      this.state.placeholderElement = placeholder;
    }
    let placeholder = this.state.placeholderElement;
    placeholder.textContent = message;
    wrapper.replaceChildren(placeholder);
    return placeholder;
  };

  destroyEditorUI = () => {
    if (this.state.vimToggle) {
      this.state.vimToggle.removeEventListener('click', this.handleVimToggle);
    }
    if (this.state.saveButton) {
      this.state.saveButton.removeEventListener('click', this.handleSaveClick);
    }
    if (this.state.revertButton) {
      this.state.revertButton.removeEventListener('click', this.handleRevertClick);
    }
    if (this.state.editorMount) {
      this.state.editorMount.destroy();
    }
    if (this.state.fallbackTextarea) {
      this.state.fallbackTextarea.removeEventListener('input', this.handleFallbackInput);
    }
    this.state.hostElement = null;
    this.state.editorMount = null;
    this.state.editorContainer = null;
    this.state.vimToggle = null;
    this.state.saveButton = null;
    this.state.revertButton = null;
    this.state.pathLabel = null;
    this.state.statusEl = null;
    this.state.fallbackTextarea = null;
  };

  buildEditorShell = () => {
    let wrapper = document.querySelector('#CodeEditor');
    if (!wrapper) {
      return null;
    }
    this.destroyEditorUI();
    this.state.placeholderElement = null;
    let root = d.el('div', {
      class: 'CodeEditor-root flex h-full flex-col rounded-md border border-slate-800/60 bg-slate-950/70',
    });
    let toolbar = d.el('div', {
      class: 'CodeEditor-toolbar flex items-center gap-3 border-b border-slate-800/60 px-3 py-2 text-xs text-slate-200',
    });
    let pathLabel = d.el('div', {
      class: 'CodeEditor-path flex-1 truncate font-mono text-sm text-slate-100',
    });
    let right = d.el('div', {
      class: 'flex items-center gap-2',
    });
    let statusEl = d.el('div', {
      class: 'CodeEditor-status text-xs text-slate-400 opacity-0 transition-opacity',
    });
    let buttonGroup = d.el('div', {
      class: 'flex items-center gap-2',
    });
    let vimToggle = d.el('button', {
      type: 'button',
      class: 'CodeEditor-vimToggle outline-none rounded border border-slate-700/70 px-3 py-1 text-xs bg-slate-900/70 hover:bg-slate-900 transition-colors',
      textContent: 'Vim Off',
    });
    vimToggle.setAttribute('aria-pressed', 'false');
    let revertButton = d.el('button', {
      type: 'button',
      class: 'CodeEditor-revert outline-none rounded px-3 py-1 text-xs bg-slate-800/70 hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:hover:bg-slate-800',
      textContent: 'Revert',
    });
    let saveButton = d.el('button', {
      type: 'button',
      class: 'CodeEditor-save outline-none rounded px-3 py-1 text-xs bg-[#0071b2] hover:bg-[#008ad9] transition-colors disabled:opacity-50 disabled:hover:bg-[#0071b2]',
      textContent: 'Save',
      disabled: true,
    });
    buttonGroup.append(vimToggle, revertButton, saveButton);
    right.append(statusEl, buttonGroup);
    toolbar.append(pathLabel, right);
    let editorContainer = d.el('div', {
      class: 'CodeEditor-editor relative flex flex-1 min-h-0 overflow-hidden',
    });
    let editorInner = d.el('div', {
      class: 'CodeEditor-editorInner flex-1 min-h-0',
    });
    editorContainer.append(editorInner);
    root.append(toolbar, editorContainer);
    wrapper.replaceChildren(root);
    vimToggle.addEventListener('click', this.handleVimToggle);
    revertButton.addEventListener('click', this.handleRevertClick);
    saveButton.addEventListener('click', this.handleSaveClick);
    this.state.hostElement = root;
    this.state.editorContainer = editorInner;
    this.state.vimToggle = vimToggle;
    this.state.saveButton = saveButton;
    this.state.revertButton = revertButton;
    this.state.pathLabel = pathLabel;
    this.state.statusEl = statusEl;
    return root;
  };

  resolveMode = path => {
    if (!path) {
      return null;
    }
    let lower = path.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'htmlmixed';
    if (lower.endsWith('.css')) return 'css';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'javascript';
    return null;
  };

  resolveTabSize = path => {
    if (!path) return 2;
    let lower = path.toLowerCase();
    if (lower.endsWith('.py')) return 4;
    if (lower.endsWith('.go')) return 4;
    return 2;
  };

  shouldIndentWithTabs = path => {
    if (!path) return false;
    let lower = path.toLowerCase();
    if (lower.endsWith('.go') || lower.endsWith('.makefile')) return true;
    return false;
  };

  mountEditor = async (value, path) => {
    if (!this.state.editorContainer) {
      return;
    }
    this.state.editorContainer.innerHTML = '';
    this.state.fallbackTextarea = null;
    try {
      this.state.editorMount = await mountCodeMirror(this.state.editorContainer, {
        value,
        mode: this.resolveMode(path),
        theme: 'monokai',
        keyMap: state.settings?.opt?.vim ? 'vim' : 'default',
        lineNumbers: true,
        lineWrapping: true,
        tabSize: this.resolveTabSize(path),
        indentUnit: this.resolveTabSize(path),
        indentWithTabs: this.shouldIndentWithTabs(path),
        autofocus: true,
        onChange: editorInstance => this.handleEditorChange(editorInstance),
      });
      queueMicrotask(() => this.state.editorMount?.editor?.refresh?.());
    } catch (err) {
      console.error(err);
      let textarea = d.el('textarea', {
        class: 'CodeEditor-fallback w-full flex-1 min-h-0 resize-none border-0 bg-transparent p-4 text-sm text-slate-100 font-mono outline-none',
      });
      textarea.value = value;
      textarea.addEventListener('input', this.handleFallbackInput);
      this.state.editorContainer.append(textarea);
      this.state.fallbackTextarea = textarea;
      this.state.editorMount = null;
    }
  };

  handleEditorChange = editorInstance => {
    if (!editorInstance) {
      return;
    }
    let value = editorInstance.getValue();
    if (value == null) {
      value = '';
    }
    this.state.currentValue = value;
    this.updateDirtyState();
  };

  handleFallbackInput = ev => {
    this.state.currentValue = ev.target.value;
    this.updateDirtyState();
  };

  updateDirtyState = () => {
    let dirty = this.state.currentValue !== this.state.initialValue;
    if (dirty !== this.state.dirty) {
      this.state.dirty = dirty;
      if (dirty) {
        this.setStatus('Unsaved changes', 'warn');
      } else if (!this.state.loading && !this.state.saving) {
        this.setStatus('All changes saved', 'success');
      }
    }
    this.updateToolbar();
  };

  getCurrentValue = () => {
    if (this.state.editorMount?.editor) {
      let value = this.state.editorMount.editor.getValue();
      return value == null ? '' : value;
    }
    if (this.state.fallbackTextarea) {
      return this.state.fallbackTextarea.value ?? '';
    }
    if (this.state.currentValue != null) {
      return this.state.currentValue;
    }
    return '';
  };

  setStatus = (message, tone = 'muted') => {
    this.state.statusMessage = message || '';
    this.state.statusTone = tone;
    if (!this.state.statusEl) {
      return;
    }
    let el = this.state.statusEl;
    el.textContent = this.state.statusMessage;
    el.classList.remove('text-slate-400', 'text-yellow-400', 'text-green-400', 'text-red-400');
    let toneClass = 'text-slate-400';
    if (tone === 'warn') toneClass = 'text-yellow-400';
    else if (tone === 'success') toneClass = 'text-green-400';
    else if (tone === 'error') toneClass = 'text-red-400';
    el.classList.add(toneClass);
    el.classList.toggle('opacity-0', !this.state.statusMessage);
  };

  updateToolbar = () => {
    if (this.state.pathLabel) {
      let projectName = this.state.currentProject ? this.state.currentProject.split(':')[0] : '';
      let label = this.state.currentPath || '';
      if (projectName && label) {
        label = `${projectName}/${label}`;
      }
      if (!label) {
        label = 'No file selected';
      }
      this.state.pathLabel.textContent = label;
    }
    if (this.state.saveButton) {
      let disabled = !this.state.dirty || this.state.loading || this.state.saving;
      this.state.saveButton.disabled = !!disabled;
      this.state.saveButton.textContent = this.state.saving ? 'Saving…' : 'Save';
    }
    if (this.state.revertButton) {
      let disabled = !this.state.currentPath || this.state.loading;
      this.state.revertButton.disabled = !!disabled;
    }
    if (this.state.vimToggle) {
      let enabled = !!state.settings?.opt?.vim;
      this.state.vimToggle.textContent = enabled ? 'Vim On' : 'Vim Off';
      this.state.vimToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
  };

  applyVim = async () => {
    let enabled = !!state.settings?.opt?.vim;
    if (this.state.editorMount) {
      await this.state.editorMount.setKeyMap(enabled ? 'vim' : 'default');
    }
    this.updateToolbar();
  };

  handleSettingsOption = async ({ k }) => {
    if (k !== 'vim') {
      return;
    }
    await this.applyVim();
  };

  handleVimToggle = async () => {
    await post('settings.option', 'vim');
    await this.applyVim();
  };

  handleSaveClick = async () => {
    await this.actions.save();
  };

  handleRevertClick = async () => {
    await this.actions.revert();
  };

  handleKeyDown = ev => {
    if (!this.state.hostElement || !this.state.hostElement.isConnected) {
      return;
    }
    if (!this.state.currentPath) {
      return;
    }
    let key = (ev.key || '').toLowerCase();
    if ((ev.metaKey || ev.ctrlKey) && key === 's') {
      ev.preventDefault();
      this.actions.save();
    }
    if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey && key === 'r') {
      ev.preventDefault();
      this.actions.revert();
    }
  };

  handleFileChange = async ({ path }) => {
    if (!this.state.currentProject || !this.state.currentPath) {
      return;
    }
    if (!path) {
      return;
    }
    let projectName = this.state.currentProject.split(':')[0];
    if (!path.startsWith(`${projectName}/`)) {
      return;
    }
    let relative = path.slice(projectName.length + 1);
    if (relative !== this.state.currentPath) {
      return;
    }
    let now = performance.now();
    if (this.state.recentSaveAt && now - this.state.recentSaveAt < 750) {
      return;
    }
    if (this.state.dirty) {
      this.state.externalChange = true;
      this.setStatus('File changed elsewhere. Revert to reload.', 'warn');
      this.updateToolbar();
      return;
    }
    await this.actions.open();
    this.setStatus('Reloaded updated file', 'muted');
  };

  attachHandlers = () => {
    if (!this.state.handlersAttached) {
      addEventListener('keydown', this.handleKeyDown);
      this.state.handlersAttached = true;
    }
    if (!this.state.busSubscribed) {
      let bus = state.event?.bus;
      if (bus) {
        bus.on('settings:global:option:ready', this.handleSettingsOption);
        bus.on('files:change', this.handleFileChange);
        this.state.busSubscribed = true;
      }
    }
  };

  actions = {
    init: () => {
      let bus = state.event?.bus;
      if (!bus) {
        return;
      }
      if (this.state.ready) {
        return;
      }
      document.head.append(d.el('style', `
        .CodeMirror-cursors { position: absolute !important }
        .CodeMirror-measure { display: none }
        .CodeMirror-lines > [role="presentation"] > :nth-child(3) { position: absolute !important; pointer-events: none }
        .CodeMirror-line { padding-left: 3rem !important }
      `));
      bus.on('files:select:ready', async ({ path }) => {
        if (!path) {
          await post('codeEditor.reset');
          return;
        }
        await post('codeEditor.open');
      });
      this.attachHandlers();
      this.state.ready = true;
      bus.emit('codeEditor:init:ready');
      if (this.state.pendingOpen) {
        this.state.pendingOpen = false;
        queueMicrotask(async () => await post('codeEditor.open'));
        return;
      }
      this.renderPlaceholder('Select a file to open it.');
    },

    open: async () => {
      if (!this.state.ready) {
        this.state.pendingOpen = true;
        return;
      }
      let project = state.projects.current;
      let path = state.files.current;
      if (!project || !path || !this.state.target(path)) {
        await post('codeEditor.reset');
        return;
      }
      this.state.loading = true;
      this.setStatus('Loading…', 'muted');
      this.renderPlaceholder(`Loading ${path}…`);
      try {
        let blob = await rfiles.load(project, path);
        if (!blob) {
          throw new Error('File not found');
        }
        let text = await blob.text();
        this.state.currentProject = project;
        this.state.currentPath = path;
        this.state.initialValue = text;
        this.state.currentValue = text;
        this.state.dirty = false;
        this.state.externalChange = false;
        let shell = this.buildEditorShell();
        if (!shell) {
          this.state.loading = false;
          return;
        }
        await this.mountEditor(text, path);
        await this.applyVim();
        this.state.loading = false;
        this.setStatus('All changes saved', 'success');
        this.updateToolbar();
      } catch (err) {
        console.error(err);
        this.state.loading = false;
        this.state.currentProject = null;
        this.state.currentPath = null;
        this.setStatus('Failed to load file', 'error');
        this.renderPlaceholder('Failed to load file.');
      }
    },

    reset: async () => {
      this.state.currentProject = null;
      this.state.currentPath = null;
      this.state.initialValue = '';
      this.state.currentValue = '';
      this.state.dirty = false;
      this.state.loading = false;
      this.state.saving = false;
      this.state.externalChange = false;
      this.state.statusMessage = '';
      this.state.statusTone = 'muted';
      this.destroyEditorUI();
      this.renderPlaceholder('Select a file to open it.');
    },

    save: async () => {
      if (!this.state.currentProject || !this.state.currentPath) {
        return;
      }
      if (this.state.loading || this.state.saving) {
        return;
      }
      this.state.currentValue = this.getCurrentValue();
      if (!this.state.dirty && this.state.currentValue === this.state.initialValue) {
        this.updateToolbar();
        return;
      }
      this.state.saving = true;
      this.state.externalChange = false;
      this.setStatus('Saving…', 'muted');
      this.updateToolbar();
      try {
        let project = this.state.currentProject;
        let path = this.state.currentPath;
        let value = this.state.currentValue;
        let type = typeof mimeLookup === 'function' ? mimeLookup(path) : null;
        if (!type) {
          type = 'text/plain';
        }
        let blob = new Blob([value], { type });
        await rfiles.save(project, path, blob);
        this.state.initialValue = value;
        this.state.dirty = false;
        this.state.recentSaveAt = performance.now();
        this.setStatus('All changes saved', 'success');
        this.updateToolbar();
        let projectName = project.split(':')[0];
        let bus = state.event?.bus;
        if (bus) {
          bus.emit('files:change', { path: `${projectName}/${path}` });
        }
      } catch (err) {
        console.error(err);
        this.setStatus('Save failed', 'error');
      } finally {
        this.state.saving = false;
        this.updateToolbar();
      }
    },

    revert: async () => {
      if (!this.state.currentPath) {
        return;
      }
      await this.actions.open();
    },

    change: async () => {},
  };
}
