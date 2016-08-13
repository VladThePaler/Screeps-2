
var spawnCreeps = {}

function countTargetingCreeps(target){
    var ret = 0
    for(var name in Game.creeps){
        if(Game.creeps[name].memory.target === target.id)
            ret++
    }
    return ret
}

function sourcePredicate(s){
    // Skip empty sources, but if it's nearing to regenration, it's worth approaching.
    // This way, creeps won't waste time by wandering about while waiting regeneration.
    // The rationale behind this number is that you can reach the other side of a room
    // approximately within 50 ticks, provided that roads are properly layed out.
    return  (0 < s.energy || s.ticksToRegeneration < 50) &&
        // If there are enough harvesters gathering around this source, skip it.
        //(!Memory.sources[s.id] || Memory.sources[s.id].length < 2)
        countTargetingCreeps(s) < countAdjacentSquares(s.pos,
            s2 => s2.type === LOOK_TERRAIN && s2[LOOK_TERRAIN] !== 'wall')+1
}

function countAdjacentSquares(pos, filter){
    var squares = 0
    var room = Game.rooms[pos.roomName]
    if(room)
        room.lookAtArea(Math.max(0, pos.y-1), Math.max(0, pos.x-1),
            Math.min(49, pos.y+1), Math.min(49, pos.x+1), true).forEach(s => {
                if(filter(s))
                    squares++
            })
    return squares
}

var roleHarvester = {

    sortDistance: function(){
        for(let k in Game.spawns){
            let spawn = Game.spawns[k]
            spawnCreeps[k] = _.filter(Game.creeps, (creep) => creep.room === spawn.room &&
                (creep.memory.role === 'harvester' || creep.memory.role === 'builder' && creep.memory.task !== 'build'))
            for(var i = 0; i < spawnCreeps[k].length; i++)
                spawnCreeps[k][i].spawnDist = spawnCreeps[k][i].pos.getRangeTo(spawn)
            spawnCreeps[k].sort((a,b) => a.spawnDist - b.spawnDist)
            distArray = [];
            for(let i = 0; i < spawnCreeps[k].length; i++)
                distArray[i] = spawnCreeps[k][i].spawnDist
            // Debug log
            //console.log(distArray)
        }
    },

    countTargetingCreeps: countTargetingCreeps,

    sourcePredicate: sourcePredicate,

    countAdjacentSquares: countAdjacentSquares,

    /** @param {Creep} creep **/
    run: function(creep) {
        function totalEnergy(){
            var energy = 0, energyCapacity = 0
            energy += Game.spawns.Spawn1.energy
            energyCapacity += Game.spawns.Spawn1.energyCapacity
            var exts = creep.room.find(FIND_MY_STRUCTURES, {filter: (s) => s.structureType === STRUCTURE_EXTENSION})
            for(var i = 0; i < exts.length; i++){
                energy += exts[i].energy;
                energyCapacity += exts[i].energyCapacity
            }
            return [energy, energyCapacity]
        }

        /// Returns number of energy resource this creep could harvest in the same
        /// duration of moving dist.
        function totalPotentialHarvests(creep, dist){
            var workParts = creep.getActiveBodyparts(WORK)
            var harvestsPerTick = workParts * 2
            // Debug log
            //console.log('workParts: ' + workParts + ', totalPotentialHarvests: ' + totalPotentialHarvests)
            return harvestsPerTick * dist
        }

        if(creep.carry.energy === creep.carryCapacity){
            creep.memory.task = undefined
            creep.memory.target = undefined
        }

        if(creep.memory.task === 'harvest' || creep.carry.energy === 0) {
            if(!creep.memory.target){
                if(creep.memory.task !== 'harvest'){
                    creep.memory.task = 'harvest'
                    creep.say('harvester')
                }
                let hostile = creep.pos.findClosestByRange(FIND_HOSTILE_STRUCTURES, {
                    filter: s => !(s instanceof StructureController) && s.hits < 1e5 && s.pos.getRangeTo(creep.pos) < 25
                })
                if(hostile){
                    if(creep.dismantle(hostile) === ERR_NOT_IN_RANGE)
                        creep.moveTo(hostile)
                    return
                }
                var energies = totalEnergy()
                var thirsty = true
                var spawn
                for(let k in Game.spawns)
                    if(Game.spawns[k].room === creep.room)
                        spawn = Game.spawns[k]
                if(!spawn || energies[0] < energies[1] && spawnCreeps[spawn.name].indexOf(creep) < 3){
                    var source = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                        filter: s => (s.structureType === STRUCTURE_CONTAINER || s.structureType === STRUCTURE_STORAGE) && 0 < s.store.energy ||
                            s.structureType === STRUCTURE_LINK && s.sink && 0 < s.energy
                    });
                    if(source){
                        if(creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                            creep.moveTo(source);
                        }
                        thirsty = false
                    }
    	        }
                if(thirsty){
                    var target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES);
                    var path = target ? creep.pos.findPathTo(target) : null
                    // Go to dropped resource if a valid path is found to it and worth it
                    if(target && path && path.length && totalPotentialHarvests(creep, path.length) < target.amount){
                        creep.move(path[0].direction)
                        creep.pickup(target);
                    }
                    else if(!creep.room.controller || creep.room.controller.my || !creep.room.controller.owner){
                        var target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                            filter: s => s.structureType === STRUCTURE_LINK && s.sink && 0 < s.energy &&
                                creep.pos.getRangeTo(s) <= 5
                        })
                        if(target){
                            if(creep.withdraw(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
                                creep.moveTo(target);
                        }
                        else{
                            var sources = []
                            // We can't find the closest source among multiple rooms.
        /*                    for(let k in Game.spawns){
                                let spawn = Game.spawns[k]
                                if(spawn.my)
                                    sources = sources.concat(spawn.room.find(FIND_SOURCES))
                            }*/
                            //console.log(creep.name + ': ' + sources.length)

                            // Find the closest source in this room.
                            function findAndHarvest(){
                                var source = creep.pos.findClosestByRange(FIND_SOURCES, {filter: sourcePredicate})
                                if(source){
                                    if(creep.harvest(source) === ERR_NOT_IN_RANGE) {
                                        creep.moveTo(source);
                                        creep.memory.target = source.id
                                        //console.log(source.id + ' Adj: ' + countAdjacentSquares(source.pos,
                                        //    s2 => s2.type === LOOK_TERRAIN && s2[LOOK_TERRAIN] !== 'wall'))
/*                                        if(!Memory.sources)
                                            Memory.sources = {source.id: [creep.name]}
                                        let sourceMem = Memory.sources[source.id]
                                        if(sourceMem.indexOf(creep.name) < 0)
                                            sourceMem.push(creep.name)*/
                                        return true
                                    }
                                    return true
                                }
                                return false
                            }

                            if(findAndHarvest());
                            else{

                                if(Game.flags.extra !== undefined){
                                    creep.moveTo(Game.flags.extra)
/*                                    let flagroom = Game.flags.extra.room
                                    if(flagroom === creep.room){
                                        findAndHarvest()
                                    }
                                    else{
                                        let exit = creep.room.findExitTo(flagroom)
                                        //console.log(creep.name + ': harvester flagroom: ' + flagroom + 'idle: ' + exit)
                                        creep.moveTo(flagroom)*/
        /*                                if(0 <= exit){
                                            let expos = creep.pos.findClosestByRange(exit)
                                            creep.moveTo()
                                        }*/
                                    //}
                                }
                                else{

                                    // If this creep cannot allot the right to harvest a source, get out of the way
                                    // for other creeps.
                                    var source = creep.pos.findClosestByRange(FIND_SOURCES)
                                    var sourceRange = creep.pos.getRangeTo(source)
                                    if(sourceRange <= 2){
                                        let awayPath = PathFinder.search(creep.pos, {pos: source.pos, range: 3}, {flee: true}).path
                                        //console.log(awayPath)
                                        if(awayPath.length)
                                            creep.moveTo(awayPath[awayPath.length-1])
                                    }
                                    else if(4 < sourceRange){
                                        creep.moveTo(source)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else{
                // If this creep finds dropped resources next to it, pick it up
                // even if a target is acquired, because it won't cost a tick.
                var target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, s => creep.pos.getRangeTo(s) <= 2);
                if(target)
                    creep.pickup(target)

                var target = Game.getObjectById(creep.memory.target)
                if(target instanceof Source && 0 < target.energy){
                    if(creep.harvest(target) === ERR_NOT_IN_RANGE)
                        creep.moveTo(target);
                }
                else{
                    console.log('NO source target! ' + target)
                    creep.memory.target = undefined
                }
            }
            creep.memory.resting = undefined
        }
        else {
            function tryFindTarget(types, isFilled){
                var target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: s => {
                        for(var i = 0; i < types.length; i++){
                            if(types[i] === s.structureType && isFilled(s))
                                return true
                        }
                        return false
                    }
                })
                if(target){
                    if(creep.transfer(target, RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                        creep.moveTo(target);
                    }
                    creep.memory.resting = undefined
                    //creep.say('fill ' + target.structureType)
                    return true
                }
                return false
            }

            // Precede filling tower, then extension and spawn, lastly container and storage.
            if(!tryFindTarget([STRUCTURE_TOWER], s => {
                    // Tower tend to spend tiny amount of energy from time to time for repairing
                    // roads and containers, so don't spend time for filling tiny amount of energy.
                    // Specifically, if this creep can harvest more than the energy amount it could
                    // transfer to the tower in the same duration of moving to the tower, it's not
                    // worth transferring (spending time for harvesting is more beneficial).
                    // That said, if the tower is getting short in energy, we can't help but restoring it.
                    if(s.energy < s.energyCapacity * 0.7)
                        return true
                    var fillableEnergy = Math.min(creep.carry.energy, s.energyCapacity - s.energy)
                    return totalPotentialHarvests(creep, creep.pos.getRangeTo(s)) < fillableEnergy}) &&
                !tryFindTarget([STRUCTURE_LINK], s => {
                    if(!s.source || !(s.energy < s.energyCapacity) || 3 < creep.pos.getRangeTo(s))
                        return false
                    var fillableEnergy = Math.min(creep.carry.energy, s.energyCapacity - s.energy)
                    return totalPotentialHarvests(creep, creep.pos.getRangeTo(s)) < fillableEnergy}) &&
                !tryFindTarget([STRUCTURE_EXTENSION, STRUCTURE_SPAWN], s => s.energy < s.energyCapacity) &&
                (!creep.room.controller || !creep.room.controller.my ||
                    !tryFindTarget([STRUCTURE_CONTAINER, STRUCTURE_STORAGE], s => s.store.energy < s.storeCapacity)))
            {
                // If there's nothing to do, find a room with least working force
                // and visit it as a helping hand.
                // Technically, the least working force does not necessarily meaning
                // the highest demand, but it's simple and effective approximation.
                var leastSpawn = null
                var leastHarvesterCount = 10
                for(let k in Game.spawns){
                    let spawn = Game.spawns[k]
                    if(spawn.my){
                        let harvesterCount = _.filter(Game.creeps, c => c.room === spawn.room && c.memory.role === 'harvester').length
                        if(harvesterCount < leastHarvesterCount){
                            leastHarvesterCount = harvesterCount
                            leastSpawn = spawn
                        }
                    }
                }
                //console.log(leastSpawn + ' ' + leastHarvesterCount)
                if(leastSpawn)
                    creep.moveTo(leastSpawn)
                creep.memory.task = 'harvest'

                // Temporarily disable the code to go to resting place since
                // creeps in the other rooms than the location of rest flag
                // rush to the flag.
/*                var flag = Game.flags['rest']
                if(flag && !flag.pos.isNearTo(creep.pos))
                    creep.moveTo(flag)
                else if(!creep.memory.resting){
                    creep.say('at flag')
                    creep.memory.resting = true
                }*/
            }
        }
    }
};

module.exports = roleHarvester;
