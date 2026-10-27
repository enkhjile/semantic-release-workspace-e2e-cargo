if(process.env.ACCEPTANCE_NPM_PATH)process.env.PATH=process.env.ACCEPTANCE_NPM_PATH+':'+process.env.PATH;
export default {branches:['stable-alpha6-live',{name:'alpha6-live',channel:'alpha6',prerelease:'alpha6'}],tagFormat:'workspace-v${version}',plugins:[['semantic-release-workspace',{publish:true,changelog:true,cargo:{trustedPublishing:true}}]]};
