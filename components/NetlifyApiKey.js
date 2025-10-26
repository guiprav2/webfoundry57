class NetlifyApiKey {
  constructor(props) { this.props = props; this.value = props.key || '' }
  get valid() { return this.value.trim() }

  onKeyDown = ev => {
    if (ev.key !== 'Enter' || this.props.multiline) { return }
    ev.preventDefault();
    ev.target.closest('form').querySelector('[value="ok"]').click();
  };

  onSubmit = ev => { ev.preventDefault(); this.root.parentElement.returnDetail = this.value; this.root.parentElement.close(ev.submitter.value) };
}

export default NetlifyApiKey;
