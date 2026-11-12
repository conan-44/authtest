((root, factory) => {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.TowerDefenceLevels = api;
})(globalThis, () => {
    const SIZE = 12;

    function validate(path) {
        if (!Array.isArray(path) || path.length < 2 || path.length > SIZE * SIZE) {
            throw new Error('A path must contain between 2 and 144 tiles.');
        }
        const visited = new Set();
        path.forEach((point, index) => {
            if (!Array.isArray(point) || point.length !== 2 || point.some(value =>
                !Number.isInteger(value) || value < 0 || value >= SIZE)) {
                throw new Error('Path coordinates must be within the 12 by 12 grid.');
            }
            const key = point.join(',');
            if (visited.has(key)) throw new Error('A path cannot visit the same tile twice.');
            visited.add(key);
            if (index && Math.abs(point[0] - path[index - 1][0]) + Math.abs(point[1] - path[index - 1][1]) !== 1) {
                throw new Error('Path tiles must be horizontally or vertically adjacent.');
            }
        });
        return path.map(point => [...point]);
    }

    function encode(path) {
        return `TD1:${validate(path).map(point => point.join(',')).join(';')}`;
    }

    function decode(value) {
        if (typeof value !== 'string' || !/^TD1:\d{1,2},\d{1,2}(;\d{1,2},\d{1,2})+$/.test(value)) {
            throw new Error('Invalid level string. Expected TD1:row,column;row,column;...');
        }
        return validate(value.slice(4).split(';').map(point => point.split(',').map(Number)));
    }

    return { SIZE, validate, encode, decode };
});
