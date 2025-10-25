class CodeDialog {
  constructor(props) {
    this.props = props;
  }

  onAttach = () => {
    let wrapper = this.root.querySelector('.CodeDialog-editorWrapper');
    if (!wrapper) {
      return;
    }
    wrapper.innerHTML = '';
    let container = d.el('div', {
      class: 'flex flex-1 flex-col gap-3 rounded-md border border-slate-800/60 bg-slate-950/70 p-4',
    });
    let message = d.el('div', {
      class: 'italic text-center text-slate-400 text-sm',
    });
    message.textContent = 'Code editing is temporarily unavailable while the new editor is being prepared.';
    container.append(message);
    if (this.props.initialValue) {
      let preview = d.el('pre', {
        class: 'CodeDialog-preview whitespace-pre-wrap break-words bg-slate-950/50 border border-slate-800/60 rounded-md p-3 text-xs text-slate-200',
      });
      preview.textContent = this.props.initialValue;
      container.append(preview);
    }
    wrapper.append(container);
  };

  onSubmit = ev => {
    ev.preventDefault();
    this.root.returnDetail = this.props.initialValue ?? '';
    this.root.close(ev.submitter.value);
  };
}

export default CodeDialog;
