import { isMedia } from '../other/util.js';

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
  };

  renderHost = message => {
    let wrapper = document.querySelector('#CodeEditor');
    if (!wrapper) {
      return null;
    }
    let host = this.state.hostElement;
    if (!host) {
      host = d.el('div', {
        class: 'CodeEditor-host flex flex-1 items-center justify-center rounded-md border border-slate-800/60 bg-slate-950/70 p-6 text-center text-sm italic text-slate-300',
      });
      this.state.hostElement = host;
    }
    host.textContent = message;
    wrapper.replaceChildren(host);
    return host;
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
      bus.on('files:select:ready', async ({ path }) => {
        if (!path) {
          await post('codeEditor.reset');
          return;
        }
        await post('codeEditor.open');
      });
      this.state.ready = true;
      bus.emit('codeEditor:init:ready');
      if (this.state.pendingOpen) {
        this.state.pendingOpen = false;
        queueMicrotask(async () => await post('codeEditor.open'));
        return;
      }
      this.renderHost('Select a file to open it.');
    },

    open: async () => {
      if (!this.state.ready) {
        this.state.pendingOpen = true;
        return;
      }
      let project = state.projects.current;
      let path = state.files.current;
      if (!path) {
        await post('codeEditor.reset');
        return;
      }
      if (!this.state.target(path)) {
        await post('codeEditor.reset');
        return;
      }
      this.state.currentProject = project;
      this.state.currentPath = path;
      let message = `Preparing a new editor for ${path}.`;
      this.renderHost(message);
    },

    reset: async () => {
      this.state.currentProject = null;
      this.state.currentPath = null;
      this.state.pendingOpen = false;
      this.renderHost('Select a file to open it.');
    },

    change: async () => {},
  };
}
