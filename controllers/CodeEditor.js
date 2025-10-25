import { isMedia, debounce } from '../other/util.js';
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
    currentValue: '',
    initialValue: '',
    dirty: false,
    loading: false,
    saving: false,
    externalChange: false,
    handlersAttached: false,
    busSubscribed: false,
    fallbackTextarea: null,
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
    if (this.state.editorMount) {
      this.state.editorMount.destroy();
    }
    if (this.state.fallbackTextarea) {
      this.state.fallbackTextarea.removeEventListener('input', this.handleFallbackInput);
    }
    this.state.hostElement = null;
    this.state.editorMount = null;
    this.state.editorContainer = null;
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
    let editorContainer = d.el('div', {
      class: 'CodeEditor-editor relative flex flex-1 min-h-0 overflow-hidden',
    });
    let editorInner = d.el('div', {
      class: 'CodeEditor-editorInner flex-1 min-h-0',
    });
    editorContainer.append(editorInner);
    root.append(editorContainer);
    wrapper.replaceChildren(root);
    this.state.hostElement = root;
    this.state.editorContainer = editorInner;
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
    this.scheduleSave();
  };

  handleFallbackInput = ev => {
    this.state.currentValue = ev.target.value;
    this.updateDirtyState();
    this.scheduleSave();
  };

  updateDirtyState = () => {
    let dirty = this.state.currentValue !== this.state.initialValue;
    if (dirty !== this.state.dirty) {
      this.state.dirty = dirty;
    }
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

  scheduleSave = () => {
    if (!this.state.dirty || this.state.loading || this.state.saving) {
      return;
    }
    if (!this.debouncedAutoSave) {
      this.debouncedAutoSave = debounce(async () => {
        if (!this.state.dirty || this.state.loading || this.state.saving) {
          return;
        }
        await this.actions.save({ reason: 'auto' });
      }, 200);
    }
    this.debouncedAutoSave();
  };

  applyVim = async () => {
    let enabled = !!state.settings?.opt?.vim;
    if (this.state.editorMount) {
      await this.state.editorMount.setKeyMap(enabled ? 'vim' : 'default');
    }
  };

  handleSettingsOption = async ({ k }) => {
    if (k !== 'vim') {
      return;
    }
    await this.applyVim();
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

  attachHandlers = () => {
    if (!this.state.handlersAttached) {
      addEventListener('keydown', this.handleKeyDown);
      this.state.handlersAttached = true;
    }
    if (!this.state.busSubscribed) {
      let bus = state.event?.bus;
      if (bus) {
        bus.on('settings:global:option:ready', this.handleSettingsOption);
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
      } catch (err) {
        console.error(err);
        this.state.loading = false;
        this.state.currentProject = null;
        this.state.currentPath = null;
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
      this.destroyEditorUI();
    },

    save: async ({ reason } = {}) => {
      if (!this.state.currentProject || !this.state.currentPath) {
        return;
      }
      if (this.state.loading || this.state.saving) {
        return;
      }
      this.state.currentValue = this.getCurrentValue();
      if (!this.state.dirty && this.state.currentValue === this.state.initialValue) {
        return;
      }
      this.state.saving = true;
      this.state.externalChange = false;
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
        let projectName = project.split(':')[0];
        let bus = state.event?.bus;
        if (bus) {
          bus.emit('files:change', { path: `${projectName}/${path}` });
        }
      } catch (err) {
        console.error(err);
      } finally {
        this.state.saving = false;
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
