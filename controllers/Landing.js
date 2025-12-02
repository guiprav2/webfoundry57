export default class Landing {
  state = {
    templates: [
      {
        id: 'kankan',
        label: 'Kankan (P2P Kanban Board)',
        href: 'editor.html?git=https://github.com/guiprav2/kankan.git',
      },
      /*
      {
        id: 'mailbox',
        label: 'Mailbox Client',
        href: 'editor.html?git=https://github.com/guiprav2/mailbox.git',
      },
      */
      {
        id: 'subgpt',
        label: 'SubGPT (LLM Client)',
        href: 'editor.html?git=https://github.com/guiprav2/subgpt.git',
      },
      {
        id: 'clean',
        label: 'Clean Slate',
        href: 'editor.html?demo',
      },
    ],
    currentTemplate: 'kankan',
    currentKey: '',
    pendingKey: '',
    frameSrc: 'editor.html?git=https://github.com/guiprav2/kankan.git',
    showKeyModal: false,
    year: new Date().getFullYear(),
  };

  actions = {
    init: () => {
      this.setFrameSrc();
    },
    selectTemplate: id => {
      this.state.currentTemplate = id;
      this.setFrameSrc();
    },
    openKeyModal: () => {
      this.state.pendingKey = this.state.currentKey;
      this.state.showKeyModal = true;
    },
    closeKeyModal: () => {
      this.state.showKeyModal = false;
    },
    applyKey: () => {
      this.state.currentKey = (this.state.pendingKey || '').trim();
      this.state.showKeyModal = false;
      this.setFrameSrc();
    },
    popout: () => {
      window.open(this.buildFrameUrl(), '_blank', 'noopener,noreferrer');
    },
    scrollToDemo: () => {
      let section = document.getElementById('projectArea');
      if (section) section.scrollIntoView({ behavior: 'smooth' });
    },
  };

  setFrameSrc() {
    this.state.frameSrc = this.buildFrameUrl();
  }

  buildFrameUrl() {
    let selected = this.state.templates.find(
      template => template.id === this.state.currentTemplate,
    );
    let base = selected ? selected.href : 'editor.html';
    if (!this.state.currentKey) return base;
    let join = base.includes('?') ? '&' : '?';
    return `${base}${join}oaiKey=${encodeURIComponent(this.state.currentKey)}`;
  }
}
