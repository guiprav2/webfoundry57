import { searchPexelsPhotos } from '../other/pexels.js';

export default class PexelsGalleryDialog {
  photos = [];
  query = '';
  orientation = 'landscape';
  loading = false;
  error = '';
  selectedId = null;
  mode = 'media';

  constructor(props = {}) {
    this.props = props;
    this.mode = props.mode || 'media';
    this.query = (props.query || '').trim() || 'web design';
    this.orientation = props.orientation || 'landscape';
    this.perPage = props.perPage || 24;
    this.performSearch();
  }

  get selectedPhoto() {
    return this.photos.find(x => x.id === this.selectedId) || null;
  }

  get selectedUrl() {
    let photo = this.selectedPhoto;
    return photo?.src?.large2x || photo?.src?.large || photo?.src?.medium || photo?.src?.original || null;
  }

  thumbnailUrl(photo) {
    return photo?.src?.medium || photo?.src?.small || photo?.src?.portrait || photo?.src?.landscape || photo?.src?.tiny || '';
  }

  async performSearch(ev) {
    ev?.preventDefault?.();
    let q = this.query.trim();
    if (!q) {
      this.photos = [];
      this.error = 'Enter search terms to continue.';
      d.update();
      return;
    }
    this.loading = true;
    this.error = '';
    d.update();
    try {
      let { photos } = await searchPexelsPhotos(q, { orientation: this.orientation, perPage: this.perPage });
      this.photos = photos;
      if (!photos.find(p => p.id === this.selectedId)) this.selectedId = photos[0]?.id ?? null;
    } catch (err) {
      this.photos = [];
      this.error = err?.message || 'Failed to load results from Pexels.';
    }
    this.loading = false;
    d.update();
  }

  onQueryInput = ev => {
    this.query = ev.target.value;
    d.update();
  };

  onQueryKeyDown = ev => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    this.performSearch();
  };

  onOrientationChange = ev => {
    this.orientation = ev.target.value;
    this.performSearch();
  };

  selectPhoto(photo) {
    this.selectedId = photo?.id ?? null;
    d.update();
  }

  clearSelection = () => {
    this.selectedId = null;
    d.update();
  };

  submit = ev => {
    ev.preventDefault();
    if (!this.selectedUrl) return;
    this.root.parentElement.returnDetail = this.selectedUrl;
    this.root.parentElement.close(ev.submitter.value);
  };
}
