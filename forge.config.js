const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  packagerConfig: {
    icon: './icon',
    arch: 'x64',
    asar: false
  },

  hooks: {
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      if (platform !== 'linux') {
        return;
      }

      const flashDir = path.join(buildPath, 'flash');
      const sourceName = arch === 'arm64'
        ? 'libpepflashplayer-arm.so'
        : 'libpepflashplayer.so';

      const source = path.join(__dirname, 'flash', sourceName);
      const destination = path.join(flashDir, 'libpepflashplayer.so');

      if (!fs.existsSync(source)) {
        throw new Error(`Missing Flash plugin: ${source}`);
      }

      fs.mkdirSync(flashDir, { recursive: true });
      fs.copyFileSync(source, destination);

      console.log(`Using ${sourceName} for Linux ${arch}`);
    }
  },

  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'moshionline',
        authors: 'Moshi Online Team',
        setupIcon: './icon.ico'
      }
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin']
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO'
      }
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {}
    }
  ]
};
