
/// We don't want to waste time for picking up tiny amount of energy by diverting from
/// the main course, but if it's very close to the creep, it's worth bothering.
/// This function is a measure of how distance is worth, in energy units.
/// Unlike harvesters, transporter's time value is dependent on total travel
/// distance (you won't mind 100 feet of excess walking if your journey is a
/// mile long, but if you're walking to next building 200 feet away, it counts).
/// Nevertheless, we assume one step is worth 1/10 of total carrying capacity,
/// in order to avoid complications.
function walkCost(creep, dist){
    var carryParts = creep.getActiveBodyparts(CARRY)
    // Debug log
    //console.log('workParts: ' + workParts + ', totalPotentialHarvests: ' + totalPotentialHarvests)
    return carryParts * dist / 10
}


module.exports = {

    /** @param {Creep} creep **/
    run: function(creep) {

        // Recycle damaged creeps
        if(creep.hits < creep.hitsMax){
            let target = creep.pos.findClosestByRange(FIND_MY_STRUCTURES, {filter: {structureType: STRUCTURE_SPAWN}})
            if(target){
                if(ERR_NOT_IN_RANGE === target.recycleCreep(creep))
                    creep.moveTo(target)
            }
            else if(Game.spawns.Spawn2)
                creep.moveTo(Game.spawns.Spawn2)
            else
                creep.moveTo(Game.spawns.Spawn1)
        }
        else if(creep.memory.task === 'gather'){
            if(creep.carry.energy === creep.carryCapacity){
                creep.memory.toSpawn = undefined
                creep.memory.task = 'store'
                return
            }
            var fromSpawn = null
            var freeCapacity = creep.carryCapacity - _.sum(creep.carry)
            //if(false && fromSpawn)
            {
                let taskIssued = false
                if(fromSpawn && creep.room === fromSpawn.room || !creep.room.controller || creep.room.find(FIND_STRUCTURES, {filter: {structureType: STRUCTURE_SPAWN}}).length === 0){

                    var tasks = []

                    if(_.sum(creep.carry) < creep.carryCapacity){
                        // Always try to find and collect dropped resources
                        let target = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {filter: r => 100 < r.amount});
                        let path = target ? creep.pos.findPathTo(target) : null
                        // Go to dropped resource if a valid path is found to it and worth it
                        if(target && path && path.length && walkCost(creep, path.length) < target.amount){
                            tasks.push({
                                name: 'DropResource',
                                // Dropped resources has slightly less cost, meaning high priority, than storages.
                                cost: (creep.pos.getRangeTo(target) - .5) / Math.min(freeCapacity, target.amount),
                                target: target,
                                run: (target) => {
                                    if(ERR_NOT_IN_RANGE === creep.pickup(target))
                                        creep.moveTo(target)
                                }
                            })
                        }

                        let containers = creep.room.find(FIND_STRUCTURES, {
                            filter: s => (s.structureType === STRUCTURE_CONTAINER ||
                                s.structureType === STRUCTURE_STORAGE) &&
                                0 < s.store.energy && s.room === creep.room
                        })
                        // Pick up dropped resources and withdraw from adjacent container
                        // simultaneously, but precede resource by not issueing withdraw
                        // order if resource amount is more than available space.
                        for(let i = 0 ; i < containers.length; i++){
                            tasks.push({
                                name: 'Container',
                                cost: creep.pos.getRangeTo(containers[i]) / Math.min(freeCapacity, containers[i].store.energy),
                                target: containers[i],
                                run: container => {
                                    if(creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
                                        creep.moveTo(container)
                                }
                            })
                        }
                    }

                    let source = creep.pos.findClosestByRange(FIND_SOURCES, {filter: s => s.room === creep.room})
                    if(source){
                        if(creep.pos.getRangeTo(source) <= 2){
                            tasks.push({
                                name: 'AvoidSource',
                                // There is no cost in avoidance, it's just be very low so that
                                // avoidance won't happen when there are other important tasks.
                                cost: creep.pos.getRangeTo(source),
                                target: source,
                                run: target => {
                                    let awayPath = PathFinder.search(creep.pos, {pos: target.pos, range: 3}, {flee: true}).path
                                    //console.log(awayPath)
                                    if(awayPath.length)
                                        creep.moveTo(awayPath[awayPath.length-1])
                                }
                            })
//                            if(creep.harvest(source) === ERR_NOT_IN_RANGE){
//                                creep.moveTo(source)
//                            }
                        }
                    }

                    // Task selector
                    //if(!tasks.length)
                    //    console.log(creep.name + ': tasks: ' + tasks.length)
                    if(tasks.length){
                        let bestTask = _.reduce(tasks, (best, task) => {
                            if(task.cost < best.cost)
                                return task
                            return best
                        })
                        let costs = _.reduce(tasks, (str, task) => str += '[' + task.name +': ' + task.cost + '],', '')
                        //console.log(creep.name + ': tasks: ' + tasks.length + ': bestTask: ' + bestTask.name + ', ' + bestTask.cost + ', ' + costs + ', ' + bestTask.target)
                        bestTask.run(bestTask.target)
                        taskIssued = true
                    }
                }
                if(!taskIssued){
                    if(fromSpawn)
                        creep.moveTo(fromSpawn)
                    else if(Game.flags.dig)
                        creep.moveTo(Game.flags.dig)
                }
            }
        }
        else if(creep.memory.task === 'store'){
            function linkSpace(source){
                var ret = source.energyCapacity - source.energy
                var sink = creep.room.find(FIND_STRUCTURES, {filter: s => s.structureType === STRUCTURE_LINK && s.sink})
                if(sink.length)
                    ret += sink[0].energyCapacity - sink[0].energy
                //console.log('linkspace: ' + ret + ' ' + creep.carry.energy)
                return ret
            }

            if(creep.carry.energy === 0){
                creep.memory.task = 'gather'
            }
            var toSpawn = Game.getObjectById(creep.memory.toSpawn)
            if(!toSpawn){
                toSpawn = _.reduce(Game.spawns, (best, spawn) => {
                    var storage = spawn.room.storage
                    if(!storage)
                        return best
                    var bestStorage = best.room.storage
                    if(!bestStorage)
                        return spawn
                    return spawn.room.storage.store.energy < best.room.storage.store.energy ? spawn : best
                })
                creep.memory.toSpawn = toSpawn.id
            }
            if(toSpawn){
                if(creep.room === toSpawn.room){
                    let container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
                        filter: s => (s.structureType === STRUCTURE_STORAGE ||
                            s.structureType === STRUCTURE_CONTAINER) &&
                            s.store.energy < s.storeCapacity ||
                            // We need at least 100 space in order to transport energy to a link
                            // because it would be so inefficient unless we do.
                            (s.structureType === STRUCTURE_LINK && s.source &&
                            Math.min(creep.carry.energy, 100) < s.energyCapacity - s.energy &&
                            creep.carry.energy < linkSpace(s))
                    })
                    let amount = creep.carry.energy
                    if(creep.transfer(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE){
                        creep.moveTo(container)
                    }
                    else
                        Memory.transportedEnergy = (Memory.transportedEnergy || 0) + amount
                }
                else{
                    creep.moveTo(toSpawn)
                }
            }
        }
        else{
            creep.memory.task = 'gather'
            creep.memory.toSpawn = undefined
        }
    }
};
