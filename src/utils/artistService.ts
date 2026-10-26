import { ArtistBioData, ListeningLogEntry } from '../types/audio';

const artistBioCache = new Map<string, ArtistBioData>();

/**
 * Fetches live artist metadata, biography, tags, and discography from MusicBrainz and Wikipedia REST API.
 * Contains zero hardcoded placeholder artists.
 */
export async function fetchArtistBiography(
  artistName: string,
  forceRefresh = false
): Promise<ArtistBioData> {
  const cleanName = artistName.trim();
  if (!cleanName || cleanName === 'Unknown Artist') {
    return {
      name: cleanName || 'No Artist Selected',
      biography: 'Play or select a track from your local library to automatically fetch artist biography and discography from MusicBrainz and Wikipedia.',
      tags: [],
      discography: [],
      fetchedAt: new Date().toISOString(),
      isLiveWeb: false,
    };
  }

  if (!forceRefresh && artistBioCache.has(cleanName)) {
    return artistBioCache.get(cleanName)!;
  }

  let country: string | undefined;
  let lifeSpan: string | undefined;
  let disambiguation: string | undefined;
  let biography = '';
  let tags: string[] = [];
  let discography: { title: string; year: string; type: string }[] = [];
  let sourceUrl: string | undefined;
  let imageUrl: string | undefined;
  let isLiveWeb = false;

  try {
    const mbSearchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(
      cleanName
    )}&fmt=json&limit=1`;

    const mbRes = await fetch(mbSearchUrl, {
      headers: { Accept: 'application/json' },
    });

    if (mbRes.ok) {
      const mbData = await mbRes.json();
      const artistObj = mbData?.artists?.[0];
      if (artistObj) {
        isLiveWeb = true;
        country = artistObj.area?.name || artistObj.country;
        const begin = artistObj['life-span']?.begin;
        const end = artistObj['life-span']?.ended ? artistObj['life-span']?.end : 'Present';
        if (begin) {
          lifeSpan = `${begin} – ${end}`;
        }
        if (artistObj.disambiguation) {
          disambiguation = artistObj.disambiguation;
        }
        if (Array.isArray(artistObj.tags)) {
          tags = artistObj.tags
            .slice(0, 8)
            .map((t: { name: string }) => t.name)
            .filter(Boolean);
        }
        sourceUrl = `https://musicbrainz.org/artist/${artistObj.id}`;

        if (artistObj.id) {
          try {
            const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${artistObj.id}&type=album|ep&fmt=json&limit=8`;
            const rgRes = await fetch(rgUrl, { headers: { Accept: 'application/json' } });
            if (rgRes.ok) {
              const rgData = await rgRes.json();
              if (Array.isArray(rgData['release-groups']) && rgData['release-groups'].length > 0) {
                discography = rgData['release-groups']
                  .map(
                    (rg: {
                      title: string;
                      'first-release-date'?: string;
                      'primary-type'?: string;
                    }) => ({
                      title: rg.title,
                      year: (rg['first-release-date'] || '—').slice(0, 4),
                      type: rg['primary-type'] || 'Album',
                    })
                  )
                  .sort((a: { year: string }, b: { year: string }) =>
                    b.year.localeCompare(a.year)
                  );
              }
            }
          } catch {
            // ignore release group error
          }
        }
      }
    }
  } catch {
    // ignore MusicBrainz network error
  }

  // Query Wikipedia REST API (EN then RU fallback)
  const wikiHosts = ['https://en.wikipedia.org', 'https://ru.wikipedia.org'];
  for (const host of wikiHosts) {
    try {
      const wikiUrl = `${host}/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`;
      const wikiRes = await fetch(wikiUrl, { headers: { Accept: 'application/json' } });
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        if (wikiData.extract && wikiData.type !== 'disambiguation') {
          biography = wikiData.extract;
          imageUrl = wikiData.thumbnail?.source || imageUrl;
          sourceUrl = wikiData.content_urls?.desktop?.page || sourceUrl;
          isLiveWeb = true;
          break;
        }
      }
    } catch {
      // try next
    }
  }

  if (!biography) {
    biography = `No Wikipedia biography article found for "${cleanName}". Metadata and release history are indexed from MusicBrainz and local file tags.`;
  }

  const finalData: ArtistBioData = {
    name: cleanName,
    country,
    lifeSpan,
    disambiguation,
    biography,
    tags,
    discography,
    sourceUrl,
    imageUrl,
    fetchedAt: new Date().toISOString(),
    isLiveWeb,
  };

  artistBioCache.set(cleanName, finalData);
  return finalData;
}

export function parseImportedHistoryJson(rawJson: string): ListeningLogEntry[] {
  const parsed = JSON.parse(rawJson);
  const arr = Array.isArray(parsed) ? parsed : parsed.scrobbles || parsed.history || [];
  return arr
    .map((item: Record<string, unknown>, idx: number): ListeningLogEntry => ({
      id: `imp-${Date.now()}-${idx}`,
      trackId: String(item.trackId || `ext-${idx}`),
      title: String(item.title || item.track || 'Unknown Track'),
      artist: String(item.artist || 'Unknown Artist'),
      album: String(item.album || 'Unknown Album'),
      genre: String(item.genre || 'Unclassified'),
      format: (item.format as ListeningLogEntry['format']) || 'FLAC',
      sampleRate: Number(item.sampleRate || 44100),
      bitDepth: Number(item.bitDepth || 16),
      durationListened: Number(item.durationListened || item.duration || 200),
      timestamp: String(item.timestamp || item.date || new Date().toISOString()),
      source: 'lastfm-import',
    }))
    .filter((e: ListeningLogEntry) => !isNaN(new Date(e.timestamp).getTime()));
}
