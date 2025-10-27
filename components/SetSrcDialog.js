class SetSrcDialog {
  constructor(props) {
    this.props = props;
    this.srcValue = this.props.initialSrcValue ?? '';
    this.exprValue = this.props.initialExprValue ?? '';
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
    this.root.parentElement.returnDetail = [this.srcValue, this.exprValue];
    this.root.parentElement.close(ev.submitter.value);
  };
}

export default SetSrcDialog;
