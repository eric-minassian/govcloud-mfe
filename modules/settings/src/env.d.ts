// Modules are compiled by the app's bundler, which supports CSS Modules out of the box.
declare module '*.module.css' {
  const classNames: Record<string, string>;
  export default classNames;
}
