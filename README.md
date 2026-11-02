# TRL-IceJaZz-Core

A high-performance, strictly local audio engine built for massive libraries and zero UI clutter. IceJaZz relies on a brutalist terminal aesthetic, hardware-accelerated DSP, and deep OS integration. No cloud, no recommendation feeds, no background telemetry. Absolute control over your sound.

## CORE_ARCHITECTURE

### 01. AUDIO_ENGINE & PLAYBACK
*   **Native Blob Streaming:** Seamless local file reading via IPC protocol directly into isolated Blobs. Bypasses CORS limitations, allowing simultaneous high-res audio playback, EQ routing, and spectrum processing.
*   **Codec Support:** FLAC, WAV, MP3, OGG, OPUS, M4A, AAC, WEBM, AIFF, ALAC.
*   **Logarithmic Volume Math:** Custom logarithmic curve (volume^2.2) for precise low-end control and full dynamic range execution at max levels, working in tandem with the EQ preamp.
*   **Hardware DSP:** Integrated 10-band parametric equalizer (32 Hz - 16 kHz) via WebAudio BiquadFilterNode cascade. Includes global Preamp (-12 dB to +12 dB), custom preset writing, and bypass switches.

### 02. MASSIVE_LIBRARY_PROCESSING
*   **Zero-Lag Virtualization:** The DOM only renders rows currently visible in the viewport. Scrolling and playback execution for 4000+ tracks is instantaneous without memory leaks.
*   **Recursive Deep Scan:** Rapid background parsing of nested directories. Extracts ID3v2, Vorbis Comments, and MP4/M4A tags. Pulls APIC/METADATA_block_picture for covers and USLT/SYLT for embedded lyrics.
*   **Data Views:** Switch between Global Tracklist, Artist Cards, Album Grid, and Genre Catalogs. Includes instant search and rating filters (Unrated to 5-Star).

### 03. LYRICS & METADATA_CONTROL
*   **Synced Lyrics Engine:** Auto-parses LRC timecodes [mm:ss.xx]. The UI highlights and scrolls to the active line. Click any string to instantly seek the track to that exact timestamp.
*   **Database Editor:** Manually edit lyrics or ID3 metadata (Title, Artist, Album, Rating) directly within the side inspector. Changes are injected into the local database matrix.

### 04. SMART_LOGIC & TELEMETRY
*   **Dynamic Playlists:** Auto-generated rule-based track generation (e.g., Top Rated, Favorites, Recently Added, Long Sessions) or custom logical queries via nested AND/OR gates.
*   **Local Statistics:** Real-time tracking of runtime, top nodes, hourly activity, and lossless ratio. Full JSON export/import capability for telemetry backup.

### 05. SYSTEM_INTEGRATION & UI
*   **Customization Engine:** 6 built-in brutalist themes, granular HEX color editing (Base, Surface, Accent), adjustable UI borders (1px - 4px), and CRT scanline toggles.
*   **Overlay Mode:** Always-on-top compact HUD with adjustable opacity, showing visualizers, scrolling track info, and playback progress.
*   **Discord Rich Presence (RPC):** Broadcasts "Listening to...", track data, cover icons, and progress timers directly to your Discord profile via local IPC socket.
*   **Background Execution:** Minimizes to the Windows System Tray with context controls (Play/Pause, Next, Toggle Overlay). Supports silent launch on OS startup.
