(() => {
    const groups = [
        { selector: '[data-guest-guide]', attribute: 'guestGuide', data: 'guestGuide' },
        { selector: '[data-game-description]', attribute: 'gameDescription', data: 'gameDescriptions' }
    ];
    fetch('./data/site-content.json', { cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error(`Could not load site descriptions (${response.status}).`);
        return response.json();
    }).then(content => {
        groups.forEach(group => {
            document.querySelectorAll(group.selector).forEach(element => {
                const text = content?.[group.data]?.[element.dataset[group.attribute]];
                if (typeof text !== 'string' || !text.trim()) {
                    console.error(`Missing site description: ${group.data}.${element.dataset[group.attribute]}`);
                    element.textContent = 'Description unavailable.';
                } else {
                    element.textContent = text;
                }
            });
        });
    }).catch(error => {
        console.error('Could not load site descriptions.', error);
        groups.forEach(group => document.querySelectorAll(group.selector).forEach(element => {
            element.textContent = 'Description unavailable.';
        }));
    });
})();
