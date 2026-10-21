(() => {
  const PACKED_PIXEL_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
  const COLOR_PATTERN = /^#[\da-f]{6}$/i;
  const DEFAULT_PALETTE = [
    "#ffffff", "#000000", "#2a4d67", "#8a5a00",
    "#3b3b3b", "#007c83", "#9b267f", "#b42318",
    "#f2cc8f", "#e07a5f", "#81b29a", "#3d5a80",
    "#98c1d9", "#f4a261", "#d1495b", "#6d597a"
  ];
  const PALETTE_LIMITS = { 8: 16, 16: 8 };

  function bitWidthFor(size) {
    return size === 8 ? 4 : 3;
  }

  function packPixels(pixels, size) {
    const bitWidth = bitWidthFor(size);
    let accumulator = 0;
    let pendingBits = 0;
    let packed = "";
    pixels.forEach(pixel => {
      accumulator = (accumulator << bitWidth) | pixel;
      pendingBits += bitWidth;
      while (pendingBits >= 6) {
        pendingBits -= 6;
        packed += PACKED_PIXEL_ALPHABET[(accumulator >> pendingBits) & 63];
        accumulator &= (1 << pendingBits) - 1;
      }
    });
    if (pendingBits) {
      packed += PACKED_PIXEL_ALPHABET[(accumulator << (6 - pendingBits)) & 63];
    }
    return packed;
  }

  function unpackPixels(packed, size) {
    const bitWidth = bitWidthFor(size);
    const pixelCount = size * size;
    const expectedLength = Math.ceil(pixelCount * bitWidth / 6);
    if (typeof packed !== "string" || packed.length !== expectedLength) return null;

    const pixels = new Uint8Array(pixelCount);
    let accumulator = 0;
    let pendingBits = 0;
    let pixelIndex = 0;
    for (const character of packed) {
      const value = PACKED_PIXEL_ALPHABET.indexOf(character);
      if (value < 0) return null;
      accumulator = (accumulator << 6) | value;
      pendingBits += 6;
      while (pendingBits >= bitWidth && pixelIndex < pixelCount) {
        pendingBits -= bitWidth;
        pixels[pixelIndex++] = (accumulator >> pendingBits) & ((1 << bitWidth) - 1);
        accumulator &= (1 << pendingBits) - 1;
      }
    }
    if (pixelIndex !== pixelCount || accumulator !== 0) return null;
    return pixels;
  }

  function decodeLegacy(avatar) {
    if (!Array.isArray(avatar.palette) || avatar.palette.length < 1 || avatar.palette.length > 8
      || avatar.palette.some(color => typeof color !== "string" || !COLOR_PATTERN.test(color))
      || typeof avatar.pixels !== "string" || avatar.pixels.length !== 128
      || !/^[0-9A-Za-z_-]{128}$/.test(avatar.pixels)) {
      return null;
    }

    const palette = DEFAULT_PALETTE.slice(0, 8);
    const assignedIndexes = new Set();
    const remappedIndexes = avatar.palette.map(color => {
      const matchingDefault = palette.findIndex(defaultColor => (
        defaultColor.toLowerCase() === color.toLowerCase()
      ));
      const index = matchingDefault >= 0 && !assignedIndexes.has(matchingDefault)
        ? matchingDefault
        : Array.from({ length: 8 }, (_, candidate) => candidate)
          .find(candidate => !assignedIndexes.has(candidate));
      if (index === undefined) return -1;
      assignedIndexes.add(index);
      palette[index] = color;
      return index;
    });
    const pixels = new Uint8Array(16 * 16);
    for (let index = 0; index < avatar.pixels.length; index += 1) {
      const pair = PACKED_PIXEL_ALPHABET.indexOf(avatar.pixels[index]);
      if (pair < 0) return null;
      const first = Math.floor(pair / 8);
      const second = pair % 8;
      if (first >= remappedIndexes.length || second >= remappedIndexes.length) return null;
      pixels[index * 2] = remappedIndexes[first];
      pixels[index * 2 + 1] = remappedIndexes[second];
    }
    return { size: 16, palette, pixels };
  }

  function decode(avatar) {
    if (!avatar || typeof avatar !== "object") return null;
    if (Array.isArray(avatar.palette)) return decodeLegacy(avatar);

    const size = avatar.size;
    const paletteLimit = PALETTE_LIMITS[size];
    if (avatar.version !== 2 || !paletteLimit
      || !avatar.palette || typeof avatar.palette !== "object" || Array.isArray(avatar.palette)) {
      return null;
    }
    const palette = DEFAULT_PALETTE.slice(0, paletteLimit);
    for (const [indexText, color] of Object.entries(avatar.palette)) {
      if (!/^(0|[1-9]\d*)$/.test(indexText)) return null;
      const index = Number(indexText);
      if (index >= paletteLimit || typeof color !== "string" || !COLOR_PATTERN.test(color)) return null;
      palette[index] = color;
    }

    const pixels = unpackPixels(avatar.pixels, size);
    if (!pixels || pixels.some(pixel => pixel >= paletteLimit)) return null;
    return { size, palette, pixels };
  }

  function encode(size, palette, pixels) {
    const paletteLimit = PALETTE_LIMITS[size];
    if (!paletteLimit || !Array.isArray(palette) || palette.length !== paletteLimit
      || !pixels || pixels.length !== size * size) {
      throw new TypeError("Profile pictures must be 16×16 with 8 colors or 8×8 with 16 colors.");
    }
    if (palette.some(color => typeof color !== "string" || !COLOR_PATTERN.test(color))) {
      throw new TypeError("Profile picture colors must be six-digit hex colors.");
    }
    if ([...pixels].some(index => !Number.isInteger(index) || index < 0 || index >= paletteLimit)) {
      throw new TypeError("The profile picture contains an invalid palette index.");
    }

    const overrides = {};
    palette.forEach((color, index) => {
      if (color.toLowerCase() !== DEFAULT_PALETTE[index].toLowerCase()) {
        overrides[index] = color.toLowerCase();
      }
    });
    return { version: 2, size, palette: overrides, pixels: packPixels(pixels, size) };
  }

  function isDefault(avatar) {
    return avatar?.version === 2
      && avatar.size === 16
      && avatar.palette
      && typeof avatar.palette === "object"
      && !Array.isArray(avatar.palette)
      && Object.keys(avatar.palette).length === 0
      && avatar.pixels === "0".repeat(128);
  }

  function draw(canvas, avatar) {
    const context = canvas.getContext("2d");
    if (!context) return false;
    const decoded = decode(avatar);
    if (!decoded) return false;

    canvas.width = decoded.size;
    canvas.height = decoded.size;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, decoded.size, decoded.size);
    for (let index = 0; index < decoded.pixels.length; index += 1) {
      context.fillStyle = decoded.palette[decoded.pixels[index]];
      context.fillRect(index % decoded.size, Math.floor(index / decoded.size), 1, 1);
    }
    return true;
  }

  window.ProfileAvatars = {
    decode,
    defaultPalette: DEFAULT_PALETTE.slice(),
    draw,
    encode,
    isDefault,
    size: 16,
    paletteLimits: { ...PALETTE_LIMITS }
  };
})();
