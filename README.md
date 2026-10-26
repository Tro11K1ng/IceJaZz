# [ TRL-IceJaZz-Core :: TrollKing ]

A brutalist, local-first audio workstation built for users who despise modern corporate UI clutter, recommendation algorithms, and cloud synchronization. IceJaZz is designed to return absolute control over your media library back to you. There are no rounded corners, no soft gradients, and no hidden background telemetry - just raw data, pure sound, and a terminal-inspired aesthetic.

I built IceJaZz to focus on two things: uncompromising audio fidelity and high-contrast, text-driven functional design. Under the hood, it features a custom hardware-accelerated Web Audio engine with a 10-band equalizer, giving you maximum performance from your FLAC archives.

## CORE_FEATURES

* **Zero UI Slop:** The interface is built entirely on monospaced typography, strict spatial balance, and high-contrast accents. It is a tool, not a toy.
* **Absolute Local Independence:** No server syncing, no data harvesting, no mandatory accounts. Your files remain exclusively on your local hard drive.
* **Dynamic Smart Filtering:** Create complex, rule-based playlists using nested AND / OR logic gates. Filter your tracks by sample rate, bit depth, custom tags, and playback cycles.
* **Hardware-Accelerated DSP:** A fully integrated 10-band parametric equalizer, preamp gain control, and seamless track crossfading, all processed locally without latency.
* **Real-Time Telemetry:** Monitor your listening habits with detailed, locally generated statistics. Analyze your most played containers, peak listening hours, and lossless ratio without sending a single byte over the network.

## TECH_STACK

* **Frontend Architecture:** React, TypeScript, Vite
* **Desktop Runtime Environment:** Electron
* **Audio Processing:** Custom Web Audio API implementation
* **Visualizer Engine:** Canvas-based real-time spectrum and oscilloscope analysis

## INIT_SEQUENCE

If you want to deploy the engine locally, follow these steps:

1. **Mount Dependencies:** 
   Run `npm install` to fetch all required local packages.
2. **Boot Development Server:** 
   Run `npm run dev` to launch the application in web mode.
3. **Launch Native Desktop Client:** 
   Run `npm run jazz` to compile and open the standalone native desktop environment with system tray integration.

**ENGINE_OWNER:** TrollKing
**STATUS:** ACTIVE_DEVELOPMENT