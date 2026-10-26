export default { branches:['main',{name:'alpha',prerelease:true}], tagFormat:'workspace-v${version}', plugins:[['semantic-release-workspace',{cargo:{trustedPublishing:true},changelog:true}]] };
