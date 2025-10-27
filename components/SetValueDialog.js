class SetValueDialog {
  constructor(props) {
    this.props = props || {};
    this.value = typeof this.props.initialValue === 'string' ? this.props.initialValue : '';
    this.exprValue = typeof this.props.initialExprValue === 'string' ? this.props.initialExprValue : '';
  }

  onKeyDown = ev => {
    if (ev.key !== 'Enter') {
      return;
    }
    ev.preventDefault();
    ev.target.closest('form').querySelector('[value="ok"]').click();
  };

  onSubmit = ev => {
    ev.preventDefault();
    let dialog = this.root?.parentElement;
    if (!dialog) {
      return;
    }
    let value = (this.value ?? '').trim();
    let expr = (this.exprValue ?? '').trim();
    dialog.returnDetail = [value || null, expr || null];
    dialog.close(ev.submitter.value);
  };
}

export default SetValueDialog;
