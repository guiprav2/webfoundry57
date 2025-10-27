class SetSrcDialog {
  constructor(props) {
    this.props = props || {};
    this.srcValue = typeof this.props.initialSrcValue === 'string' ? this.props.initialSrcValue : '';
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
    let src = (this.srcValue ?? '').trim();
    let expr = (this.exprValue ?? '').trim();
    dialog.returnDetail = [src || null, expr || null];
    dialog.close(ev.submitter.value);
  };
}

export default SetSrcDialog;
