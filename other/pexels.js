let PEXELS_API_KEY = 'TvQp9hqct3J5XlyGjBUtt0TlgqiCd1UtDuJlvhl4HzfOt53BrvwuCq6b';
let SEARCH_ENDPOINT = 'https://api.pexels.com/v1/search';

let normalizeQuery = query => (query || '').trim();

let buildSearchUrl = (query, { perPage, orientation, page } = {}) => {
  let params = new URLSearchParams();
  params.set('query', query);
  params.set('per_page', perPage || 24);
  if (orientation && orientation !== 'any') params.set('orientation', orientation);
  if (page) params.set('page', page);
  return `${SEARCH_ENDPOINT}?${params.toString()}`;
};

let searchPexelsPhotos = async (query, options = {}) => {
  let q = normalizeQuery(query);
  if (!q) throw new Error('Enter search terms.');
  let url = buildSearchUrl(q, options);
  let res;
  try {
    res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });
  } catch (err) {
    throw new Error(`Failed to reach Pexels: ${err.message || err}`);
  }
  if (!res.ok) {
    let message;
    try {
      let data = await res.json();
      message = data?.error || data?.message;
    } catch {
      message = null;
    }
    throw new Error(message || `Pexels API error (${res.status})`);
  }
  let data = await res.json();
  return {
    photos: data?.photos || [],
    page: data?.page || 1,
    perPage: data?.per_page || options.perPage || 24,
    total: data?.total_results || 0,
    raw: data,
  };
};

export { searchPexelsPhotos, PEXELS_API_KEY };
export default { searchPexelsPhotos, PEXELS_API_KEY };
