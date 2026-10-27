// Module Federation needs an async boundary before any shared module (react, ...) is imported,
// so the runtime can negotiate which copy of each singleton the page will use.
import('./bootstrap');
