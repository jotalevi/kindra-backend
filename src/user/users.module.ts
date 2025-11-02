import DB from "../database/db";

export default class UsersModule {
    private static usersMap: {
        externalIDs: string[],
        internalID: string
    }[] = DB.getPlainValue('INTERNAL.USERS.IDMAP') ? JSON.parse(DB.getPlainValue('INTERNAL.USERS.IDMAP') || '[]') : [];

    private static refreshDB () : void {
        DB.setPlainValue('INTERNAL.USERS.IDMAP', JSON.stringify(this.usersMap));
        this.usersMap = JSON.parse(DB.getPlainValue('INTERNAL.USERS.IDMAP') || '[]');
    }
    
    static getInternalUserID (externalID: string): string {
        this.refreshDB();

        for (let mapping of this.usersMap) if (mapping.externalIDs.includes(externalID)) return mapping.internalID;
        
        return this.asignInternalUserID(externalID)
    }

    static asignInternalUserID (externalID: string): string {
        this.refreshDB();

        let existing = this.getInternalUserID(externalID);
        if (existing) return existing;

        let newInternalID = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;

        this.usersMap.push({
            externalIDs: [externalID],
            internalID: newInternalID
        });

        this.refreshDB();

        return newInternalID;
    }

    static matchExternalsToInternal (externalIDs: string[]): string {
        this.refreshDB();

        let loInternalIDs: string[] = [];
        let loExternalIDs: string[] = [];

        for (let externalID of externalIDs) {
            let allMapedMatching = this.usersMap.filter(m => m.externalIDs.includes(externalID));

            for (let matches of allMapedMatching) {
                loInternalIDs.push(matches.internalID);
                loExternalIDs.push(...matches.externalIDs);
            }
        }

        const uniqueIID = loInternalIDs[0] || `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const mergedExternalIDs = new Set<string>(loExternalIDs);
        
        this.usersMap = this.usersMap.filter(m => !loInternalIDs.includes(m.internalID));

        this.usersMap.push({
            externalIDs: Array.from(mergedExternalIDs),
            internalID: uniqueIID
        });        

        this.refreshDB();

        return uniqueIID;
    }

}