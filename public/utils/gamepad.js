function getGamepad(){
    var activeGamepad = false;
    //basic gamepad support

    //oculus touch controllers are recognised as controllers.
    //to work around, abuse fact that these don't have 10th button.
    //find the 1st gamepad with button 10.

    var gpads=navigator.getGamepads();
    if (gpads){
        for (gpad of gpads){
            if (gpad && gpad.buttons && gpad.buttons[10] && gpad.axes){
                activeGamepad = gpad;
                break;
            }
        }
    }

    if (!activeGamepad){return false;}

    //TODO handle choosing one of multiple gamepads and keeping that gamepad selected.
            
    //activeGamepad.buttons 0 to 15, on xbox controller are:
    //A,B,X,Y
    //L1,R1,L2,R2,
    //BACK,START,
    //L3,R3,	(analog values)
    //d-pad u,d,l,r
    //button 16? don't know (there is a central xbox button but does nothing)
            
    //activeGamepad.axes for xbox controller:
    //left thumbstick left(-1) to right(+1)
    //left thumbstick up(-1) to down(+1)
    //right thumbstick left(-1) to right(+1)
    //right thumbstick up(-1) to down(+1)

    return activeGamepad;
}