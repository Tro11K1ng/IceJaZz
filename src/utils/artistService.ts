import { ArtistBioData, AudioFormat, ListeningLogEntry } from '../types/audio';
import { terminalLogger } from './terminalLogger';

const bioCache = new Map<string, ArtistBioData>();

export async function fetchArtistBiography(
  artistName: string,
  forceRefresh = false
): Promise<ArtistBioData> {
  const cleanName = artistName.trim();
  if (!cleanName || cleanName.toLowerCase() === 'unknown artist') {
    return {
      name: cleanName || 'Unknown Artist',
      biography: 'Local audio stream without external artist metadata.',
      tags: ['Local Archive'],
      discography: [],
      isLiveWeb: false,
    };
  }

  const cacheKey = cleanName.toLowerCase();
  if (!forceRefresh && bioCache.has(cacheKey)) {
    return bioCache.get(cacheKey)!;
  }

  let country: string | undefined;
  let lifeSpan: string | undefined;
  let disambiguation: string | undefined;
  let biography = '';
  let imageUrl: string | undefined;
  let sourceUrl: string | undefined;
  const tags: string[] = [];
  const discography: { title: string; year: string; type: string }[] = [];
  let isLiveWeb = false;

  try {
    const mbSearchUrl = `https://musicbrainz.org/ws/2/artist/?query=artist:${encodeURIComponent(
      cleanName
    )}&fmt=json&limit=1`;
    const mbRes = await fetch(mbSearchUrl, {
      headers: { Accept: 'application/json' },
    });

    if (mbRes.ok) {
      const mbJson = await mbRes.json();
      const artistObj = mbJson?.artists?.[0];
      if (artistObj) {
        isLiveWeb = true;
        country = artistObj.country || artistObj.area?.name;
        disambiguation = artistObj.disambiguation;
        if (artistObj['life-span']?.begin) {
          const begin = artistObj['life-span'].begin.slice(0, 4);
          const end = artistObj['life-span'].ended
            ? artistObj['life-span'].end?.slice(0, 4) || ''
            : 'present';
          lifeSpan = `${begin} – ${end}`;
        }
        if (Array.isArray(artistObj.tags)) {
          artistObj.tags
            .slice(0, 6)
            .forEach((t: { name?: string }) => t.name && tags.push(t.name));
        }
        sourceUrl = `https://musicbrainz.org/artist/${artistObj.id}`;

        const rgUrl = `https://musicbrainz.org/ws/2/release-group?artist=${artistObj.id}&type=album|ep&fmt=json&limit=8`;
        const rgRes = await fetch(rgUrl, {
          headers: { Accept: 'application/json' },
        });
        if (rgRes.ok) {
          const rgJson = await rgRes.json();
          const groups = rgJson?.['release-groups'] || [];
          groups.forEach(
            (g: {
              title?: string;
              'first-release-date'?: string;
              'primary-type'?: string;
            }) => {
              if (g.title) {
                discography.push({
                  title: g.title,
                  year: g['first-release-date']?.slice(0, 4) || '----',
                  type: g['primary-type'] || 'Album',
                });
              }
            }
          );
          discography.sort((a, b) => b.year.localeCompare(a.year));
        }
      }
    }
  } catch {
    // Ignore MusicBrainz network errors
  }

  try {
    const wikiUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      cleanName.replace(/\s+/g, '_')
    )}`;
    const wikiRes = await fetch(wikiUrl);
    if (wikiRes.ok) {
      const wikiJson = await wikiRes.json();
      if (wikiJson?.extract && wikiJson.type !== 'disambiguation') {
        biography = wikiJson.extract;
        isLiveWeb = true;
        if (wikiJson.thumbnail?.source) {
          imageUrl = wikiJson.thumbnail.source;
        }
        if (wikiJson.content_urls?.desktop?.page) {
          sourceUrl = wikiJson.content_urls.desktop.page;
        }
      }
    }
  } catch {
    // Ignore Wikipedia network errors
  }

  if (!biography) {
    biography = `${cleanName} — indexed artist in local IceJaZz audio library. ${
      disambiguation ? `(${disambiguation})` : ''
    }`.trim();
  }

  const result: ArtistBioData = {
    name: cleanName,
    country,
    lifeSpan,
    disambiguation,
    biography,
    imageUrl,
    tags: tags.length > 0 ? tags : ['Audio Library'],
    discography: discography.slice(0, 6),
    sourceUrl,
    isLiveWeb,
  };

  bioCache.set(cacheKey, result);
  terminalLogger.log(
    'IO',
    `Fetched metadata profile for "${cleanName}" (${isLiveWeb ? 'Wikipedia/MusicBrainz' : 'Local Cache'})`
  );
  return result;
}

export function parseImportedHistoryJson(jsonText: string): ListeningLogEntry[] {
  const parsed = JSON.parse(jsonText);
  const rawList = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.history)
    ? parsed.history
    : Array.isArray(parsed?.entries)
    ? parsed.entries
    : [];

  const valid: ListeningLogEntry[] = [];

  for (let i = 0; i < rawList.length; i++) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') continue;

    const title = String(
      item.title || item.trackName || item.master_metadata_track_name || ''
    ).trim();
    const artist = String(
      item.artist || item.artistName || item.master_metadata_album_artist_name || 'Unknown Artist'
    ).trim();
    if (!title) continue;

    const album = String(
      item.album || item.albumName || item.master_metadata_album_album_name || 'Unknown Album'
    ).trim();
    const genre = String(item.genre || 'Unknown').trim();
    const rawFormat = String(item.format || 'FLAC').toUpperCase();
    const format: AudioFormat = (
      ['FLAC', 'WAV', 'ALAC', 'MP3', 'OGG', 'AAC'].includes(rawFormat)
        ? rawFormat
        : 'FLAC'
    ) as AudioFormat;

    const durationListened = Number(
      item.durationListened ??
        (item.msPlayed ? Math.round(item.msPlayed / 1000) : undefined) ??
        (item.ms_played ? Math.round(item.ms_played / 1000) : 180)
    );

    const timestamp = item.timestamp || item.endTime || item.ts || new Date().toISOString();

    valid.push({
      id: item.id || `imp-${Date.now()}-${i}`,
      trackId: item.trackId || `trk-imp-${i}`,
      title,
      artist,
      album,
      genre,
      format,
      sampleRate: Number(item.sampleRate || 44100),
      durationListened: Math.max(1, durationListened),
      timestamp: new Date(timestamp).toISOString(),
    });
  }

  return valid;
}
