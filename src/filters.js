/**
 * Module Filters : Génération dynamique de filtres (checkbox, select) et gestion des événements.
 * Utilisation :
 *   Filters.init(config, onChangeCallback)
 *   Filters.getState()
 */

const Filters = (function () {
    let state = {};
    let config = [];
    let onChange = null;

    function createFilterControl(filter) {
        const wrapper = document.createElement('div');
        wrapper.className = 'filter-control';

        const label = document.createElement('label');
        label.textContent = filter.label;
        label.htmlFor = filter.id;

        let input;
        if (filter.type === 'checkbox') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.id = filter.id;
            input.checked = !!filter.default;
            input.addEventListener('change', handleChange);
            state[filter.id] = input.checked;
        } else if (filter.type === 'select') {
            input = document.createElement('select');
            input.id = filter.id;
            filter.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt.value;
                option.textContent = opt.label;
                if (opt.value === filter.default) option.selected = true;
                input.appendChild(option);
            });
            input.addEventListener('change', handleChange);
            state[filter.id] = filter.default || (filter.options[0] && filter.options[0].value);
        }
        wrapper.appendChild(label);
        wrapper.appendChild(input);
        return wrapper;
    }

    function handleChange(e) {
        const id = e.target.id;
        if (e.target.type === 'checkbox') {
            state[id] = e.target.checked;
        } else {
            state[id] = e.target.value;
        }
        if (typeof onChange === 'function') {
            onChange({ ...state });
        }
    }

    function init(filtersConfig, onChangeCallback) {
        config = filtersConfig;
        onChange = onChangeCallback;
        state = {};
        const container = document.getElementById('filters-container');
        container.innerHTML = '';
        config.forEach(filter => {
            const control = createFilterControl(filter);
            container.appendChild(control);
        });
        // Appel initial pour transmettre l'état par défaut
        if (typeof onChange === 'function') {
            onChange({ ...state });
        }
    }

    function getState() {
        return { ...state };
    }

    return {
        init,
        getState
    };
})();

window.Filters = Filters;