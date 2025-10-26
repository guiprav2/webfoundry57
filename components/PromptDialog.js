class PromptDialog {
  constructor(props) {
    this.props = props;
    this.value = this.props.initialValue ?? '';
    this.props.allowEmpty ??= true;
  }
  get valid() {
    return this.props.allowEmpty || this.value;
  }

  onKeyDown = ev => {
    if (ev.key !== 'Enter' || this.props.multiline) {
      return;
    }
    ev.preventDefault();
    ev.target.closest('form').querySelector('[value="ok"]').click();
  };

  onSubmit = ev => {
    ev.preventDefault();
    this.root.parentElement.returnDetail = this.value;
    this.root.parentElement.close(ev.submitter.value);
  };
}

export default PromptDialog;
