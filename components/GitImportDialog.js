import { deriveProjectNameFromUrl, loadGitBranchInfo } from '../other/gitImport.js';

class GitImportDialog {
  constructor(props = {}) {
    this.props = props;
    this.title = props.title || 'Git Import';
    this.requireName = !!props.requireName;
    this.urlValue = props.initialUrl || '';
    this.nameValue = '';
    this.branchValue = props.initialBranch || '';
    this.branchesList = props.branches ? [...props.branches] : [];
    this.loadingFlag = false;
    this.errorMessage = '';
    this.nameError = props.nameError || '';
    this.nameEdited = !!(props.initialName && props.initialName.trim());
    this.suppressNameEdited = false;
    this.fetchTimer = null;
    this.fetchToken = 0;

    if (props.initialName) this.silentlySetName(props.initialName);
    else this.silentlySetName('');
    if (!props.initialName && this.requireName && this.urlValue) {
      let derived = deriveProjectNameFromUrl(this.urlValue);
      if (derived) this.silentlySetName(derived);
    }
    if (this.urlValue) this.scheduleBranchFetch(true);
  }

  get url() { return this.urlValue; }
  set url(val) { this.updateUrl(val); }

  get name() { return this.nameValue; }
  set name(val) {
    val ??= '';
    if (this.nameValue === val) return;
    this.nameValue = val;
    if (!this.suppressNameEdited && val.trim()) this.nameEdited = true;
    if (this.nameError) this.nameError = '';
    d.update();
  }

  get branch() { return this.branchValue; }
  set branch(val) {
    val ??= '';
    if (this.branchValue === val) return;
    this.branchValue = val;
    d.update();
  }

  get branches() { return this.branchesList; }
  get loading() { return !!this.loadingFlag; }
  get error() { return this.errorMessage; }

  get valid() {
    if (!this.url?.trim()) return false;
    if (!this.branchValue) return false;
    if (!this.branchesList.length) return false;
    if (this.loadingFlag) return false;
    if (this.errorMessage) return false;
    if (this.requireName && !this.name?.trim()) return false;
    return true;
  }

  updateUrl(value, opt = {}) {
    value ??= '';
    if (this.urlValue === value) return;
    clearTimeout(this.fetchTimer);
    this.urlValue = value;
    this.errorMessage = '';
    this.branchesList = [];
    this.branchValue = '';
    if (this.requireName && !this.nameEdited && value) {
      let derived = deriveProjectNameFromUrl(value);
      if (derived) this.silentlySetName(derived);
    }
    if (!opt.silent) d.update();
    if (!value) {
      this.loadingFlag = false;
      if (!opt.silent) d.update();
      return;
    }
    if (opt.skipFetch) return;
    this.scheduleBranchFetch();
  }

  scheduleBranchFetch(immediate = false) {
    clearTimeout(this.fetchTimer);
    if (!this.urlValue?.trim()) return;
    if (immediate) return void this.fetchBranches();
    this.fetchTimer = setTimeout(() => this.fetchBranches(), 400);
  }

  async fetchBranches() {
    clearTimeout(this.fetchTimer);
    if (!this.urlValue?.trim()) return;
    let token = ++this.fetchToken;
    this.loadingFlag = true;
    this.errorMessage = '';
    d.update();
    try {
      let info = await loadGitBranchInfo(this.urlValue);
      if (this.fetchToken !== token) return;
      this.branchesList = [...(info?.branches || [])];
      if (!this.branchesList.length) {
        this.errorMessage = 'No Git branches found.';
        this.branchValue = '';
      } else {
        let preferred = info?.defaultBranch;
        let next = preferred && this.branchesList.includes(preferred)
          ? preferred
          : this.branchesList[0];
        this.branchValue = next;
      }
      d.update();
    } catch (err) {
      if (this.fetchToken !== token) return;
      this.errorMessage = err?.message || 'Unable to read repository.';
      this.branchesList = [];
      this.branchValue = '';
      d.update();
    } finally {
      if (this.fetchToken === token) {
        this.loadingFlag = false;
        d.update();
      }
    }
  }

  silentlySetName(value) {
    this.suppressNameEdited = true;
    this.name = value ?? '';
    this.suppressNameEdited = false;
  }

  onKeyDown = ev => {
    if (ev.key !== 'Enter' || this.loadingFlag) return;
    ev.preventDefault();
    ev.target.closest('form').querySelector('[value="ok"]').click();
  };

  onSubmit = ev => {
    ev.preventDefault();
    if (!this.valid) return;
    let detail = {
      url: (this.url || '').trim(),
      branch: (this.branch || '').trim(),
      name: (this.name || '').trim(),
    };
    this.root.parentElement.returnDetail = detail;
    this.root.parentElement.close(ev.submitter.value);
  };

  onDetach = () => {
    clearTimeout(this.fetchTimer);
  };
}

export default GitImportDialog;
