// EXPLICIT_CARGO_METADATA_WORKAROUND: live alpha profile uses explicit package fields.
// PUBLIC_ESM_RESOLUTION_WORKAROUND: does not clear the normal package-name failure.
import {fileURLToPath} from 'node:url';
const plugin = fileURLToPath(import.meta.resolve('semantic-release-workspace'));
export default { branches: ['main', {name:'alpha',prerelease:true}], tagFormat:'workspace-v${version}', plugins:[[plugin,{cargo:{trustedPublishing:true},changelog:true}]] };
