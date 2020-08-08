//something to zoom in or out (for fisheye style overview) for vr cockpit view.

testForOffset(0);
testForOffset(0.2);
testForOffset(0.5);
testForOffset(0.8393);
testForOffset(0.9);
testForOffset(0.95);
testForOffset(0.98);	//~results in ~10x
testForOffset(0.99);
testForOffset(0.9998);	//results in ~100x zoom
console.log("\n"+(new Array(80)).join("-")+"\n");
testForOffset(-0.2);
testForOffset(-0.5);
testForOffset(-0.9);
testForOffset(-0.95);
testForOffset(-0.99);

function testForOffset(offsetForward){
	console.log({offsetForward});
	[0,10,20,40,80,120,160].forEach(sideAngle=>{testIt(sideAngle,offsetForward);});
}

function testIt(sideAngle, offsetForward){
	
	
	//for a spherical object at distance 1, calculate side, up vectors
	var angleRads = sideAngle * Math.PI/180;
	
	var centrePos = [ Math.sin(angleRads) , 0 , Math.cos(angleRads) ];
	var sideDir = [ Math.cos(angleRads)  , 0 , -Math.sin(angleRads) ];
	var upDir = [ 0, 1, 0 ];
	
	var smallNumber = 0.00001;
	var shiftedSidewaysPos = centrePos.map( (elem, ii) => { return elem+smallNumber*sideDir[ii];});
	var shiftedTUpwardPos = centrePos.map( (elem, ii) => { return elem+smallNumber*upDir[ii];});
	
	//shift all these by offsetForward
	centrePos[2]+=offsetForward;
	shiftedSidewaysPos[2]+=offsetForward;
	shiftedTUpwardPos[2]+=offsetForward;
	
	//get apparent height, width viewed from here.
	//basically want the cross product between directions to that point. since direction is same, ratio of sizes is like ratio of cross products of unnormalised vectors to points.
	// ie want len(centre x shiftedupward) / len(centre x shiftedsideways)

	// magnitude of cross product of centrepos, upshifted ~ smallNumber / mag(centrePos)^2
	// magnitude of cross product of centrepos, sideshifted, has only vertical component, ~ ax*by - ay*bx
	
	var dist, apparentHeight, apparentWidth;

	dist = Math.hypot( centrePos[0], centrePos[2] );
	apparentHeight = - smallNumber * dist;
	apparentWidth = centrePos[0]*shiftedSidewaysPos[2] - centrePos[2]*shiftedSidewaysPos[0];
	var ratio = apparentHeight/apparentWidth;

	//try some scaling of space to get ratio back to 1. (ie angle preserving)
	//var scaleFactor = 1/Math.cos(offsetForward);	// approxiation. kept since guess maybe useful
	var scaleFactor = 1/Math.sqrt(1-offsetForward*offsetForward);

	
	//what is the effective centre zoom then? if move halfway forward, zoom in by factor 2. however, doing this space compression/stretching undoes some of this..
	var unalteredCentreZoom = 1/(1-offsetForward);
	var effectiveCentreZoom = 1/((1-offsetForward)*scaleFactor);
	
	centrePos[2]*=scaleFactor;
	shiftedSidewaysPos[2]*=scaleFactor;
	shiftedTUpwardPos[2]*=scaleFactor;
	
	dist = Math.hypot( centrePos[0], centrePos[2] );
	apparentHeight = - smallNumber * dist;
	apparentWidth = centrePos[0]*shiftedSidewaysPos[2] - centrePos[2]*shiftedSidewaysPos[0];
	var ratio2 = apparentHeight/apparentWidth;
	
	
console.log(`${sideAngle} \t : ${apparentHeight.toFixed(4)}, ${apparentWidth.toFixed(4)}, \t ${ratio.toFixed(3)} , ${ratio2.toFixed(3)} , ... ${unalteredCentreZoom.toFixed(2)}, ${effectiveCentreZoom.toFixed(2)}`);
	
}