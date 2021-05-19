const { parse } = require('css');
import memoize from 'memoize-one';
// TODO: determine if added classNames beats out removed css by writing function that measures added text
const optimzedCssBody = `
body, text { 
    font-size: 12px;
} 
div, #hi, .hello { 
    font-size: 12px; 
    font-weight: normal;
}
#hi, .hello {
    color: red;
    text-decoration: underline;
}
.hello {
    border-radius: 1px;
}
@font-face {
    font-family: myFirstFont;
    src: url(sansation_light.woff);
}`


const fakeStylesheet = parse(`
body { 
    font-size: 12px;
} 
div { 
    font-size: 12px; 
    font-weight: normal;
}
#hi {
    font-size: 12px;
    font-weight: normal;
    color: red;
    text-decoration: underline;
}
.hello {
    font-size: 12px;
    font-weight: normal;
    color: red;
    text-decoration: underline;
    border-radius: 1px;
}
text {
    font-size: 12px;
}
@font-face {
    font-family: myFirstFont;
    src: url(sansation_light.woff);
}`, { source: 'source.css' });

enum ASTEntryType {
    DECLARATION = 'declaration',
    RULE = 'rule',
    FONTFACE = 'font-face',
    STYLESHEET = 'stylesheet',
}

interface ASTPositionMarker {
    line: number
    column: number
}

interface ASTEntry {
    type: ASTEntryType
    position: {
        start: ASTPositionMarker
        end: ASTPositionMarker
        source: string
    }
}

interface ASTDeclaration extends ASTEntry {
    type: ASTEntryType.DECLARATION
    property: string
    value: string
}

interface ASTRule extends ASTEntry {
    type: ASTEntryType.RULE
    selectors: string []
    declarations: ASTDeclaration []
}

// TODO: Handle font face
interface ASTFontFace extends ASTEntry {
    type: ASTEntryType.FONTFACE
    declarations: ASTDeclaration []
}

interface ASTStylesheet extends ASTEntry {
    type: ASTEntryType.STYLESHEET
    rules: (ASTFontFace | ASTRule) []
}

export interface CssDeclaration {
    property: string
    value: string
}

function ensureArray<T>(arr: T [] | T) {
    if(Array.isArray(arr)) {
        return arr;
    }
    return [arr];
}

export class CssGrouping {
    private _declarations: CssDeclaration []
    readonly selectors: string []
    constructor(declarations: CssDeclaration [], selectors: string []) {
        this._declarations = declarations;
        this.selectors = selectors;
    }

    // TODO: maybe just add this to class properties and calculate when declarations changes
    private innerGetPropertyMap = memoize((declarations) => {
        return declarations.reduce((prev, { property, value }) => {
            prev[property] = value;
            return prev;
        }, {})
    })
    getPropertyMap() {
        return this.innerGetPropertyMap(this._declarations);
    }

    get declarations(): CssDeclaration [] {
        const propertyMap = this.getPropertyMap();
        return Object.keys(propertyMap).map((key) => ({ property: key, value: propertyMap[key] }));
    }

    addSelectors(selectors: string [] | string) {
        const selectorsExistenceMap = this.selectors.reduce((acc, selector) => {
            acc[selector] = true;
            return acc;
        }, {});
        const selectorsToAdd = ensureArray(selectors).filter((selector) => !selectorsExistenceMap[selector]);
        this.selectors.push(...selectorsToAdd);
    }

    addDeclarations(declarations: CssDeclaration [] | CssDeclaration) {
        const declarationsToAdd = ensureArray(declarations);
        this._declarations.push(...declarationsToAdd);
    }

    removeDeclarations(declarations: CssDeclaration [] | CssDeclaration) {
        const declarationsToRemove = ensureArray(declarations);
        const propertyMap = this.getPropertyMap();
        const removeMap = declarationsToRemove.reduce((acc, { property, value }) => {
            if(propertyMap[property] === value) {
                acc[property] = true;
            }
            return acc;
        }, {});
        this._declarations = this._declarations.filter(({ property }) => !removeMap[property]);
    }

    declarationSize() {
        return this.declarations.reduce((acc, { property, value }) => acc + property.length + value.length + 2, 0); // the + 2 is simply the ":" and ";" for each css statement
    }

    selectorSize() {
        return this.selectors.reduce((acc, selector) => acc + selector.length, 0) + (this.selectors.length ? this.selectors.length - 1: 0); // the second portion accounts for commas
    }

    static compareDeclarations(grouping1: CssGrouping, grouping2: CssGrouping) {
        const grouping1Map = grouping1.getPropertyMap();
        const grouping2Map = grouping2.getPropertyMap();
        const grouping1Differences = grouping1.declarations.filter(({ property, value}) => (
            grouping2Map[property] !== value
        ));

        const grouping2Differences = grouping2.declarations.filter(({ property, value}) => (
            grouping1Map[property] !== value
        ));

        const commonValues = grouping1.declarations.filter(({ property, value }) => (
            grouping2Map[property] === value
        ));

        return {
            inFirstOnly: grouping1Differences,
            inSecondOnly: grouping2Differences,
            inBoth: commonValues,
        }
    }

    static fromAST(rule: ASTRule) {
        const selectors = rule.selectors;
        const declarations = rule.declarations.map(({ property, value }) => ({ property, value }));
        return new CssGrouping(declarations, selectors);
    }
    static toAST(grouping: CssGrouping) {
        return null; // TODO: fill this in;
    }
}

function getRuleGroupings(stylesheet: ASTStylesheet): CssGrouping [] {
    return stylesheet.rules.reduce((acc, rule)=> {
        if(rule.type === ASTEntryType.RULE) {
            const grouping = CssGrouping.fromAST(rule);
            if(grouping.declarations.length) {
                acc.push(grouping);
            }
        }
        return acc;
    }, []);
}

function combineSameGroupings(groupings: CssGrouping []) {
    const finishedGroupings: CssGrouping [] = [];
    while(groupings.length) {
        const currentGrouping = groupings.pop();
        let wasMatched = false;
        for (let i = 0; i < groupings.length; i++) {
            const { inFirstOnly, inSecondOnly, inBoth } = CssGrouping.compareDeclarations(currentGrouping, groupings[i]);
            if (inFirstOnly.length === 0 && inSecondOnly.length === 0 && inBoth.length !== 0) {
                groupings[i].addSelectors(currentGrouping.selectors);
                wasMatched = true;
                break;
            }
        }
        if (!wasMatched) {
            finishedGroupings.push(currentGrouping);
        }  
    }
    return finishedGroupings;
}


// TODO write measure 
function combineSubsets(groupings: CssGrouping []) {
    groupings.sort((a, b) => b.declarations.length - a.declarations.length);

    for (let i = 0; i < groupings.length; i++) {
        const targetGrouping = groupings[i];
        let subgroups: { totalGrouping: CssGrouping, individualGroupings: CssGrouping []} [] = [];
        // TODO: This algorithm is probably not perfect yet but its a start
        // maybe better would be DP with number of items and properties? that seems promising actually will implement after this first iteration.
        for (let j = i + 1; j < groupings.length; j++) {
            const smallerGrouping = groupings[j];
            const { inSecondOnly } = CssGrouping.compareDeclarations(targetGrouping, smallerGrouping);
            if (!inSecondOnly.length) {
                subgroups.forEach(({ totalGrouping, individualGroupings }) => {
                    if (CssGrouping.compareDeclarations(totalGrouping, smallerGrouping).inSecondOnly.length) {
                        totalGrouping.addSelectors(smallerGrouping.selectors);
                        totalGrouping.addDeclarations(smallerGrouping.declarations);
                        individualGroupings.push(smallerGrouping);
                    }
                });
                subgroups.push({ totalGrouping: new CssGrouping(smallerGrouping.declarations, smallerGrouping.selectors), individualGroupings: [ smallerGrouping ]});
            }
        }

        if(!subgroups.length) {
            continue;
        }

        const { individualGroupings, totalGrouping } = subgroups.reduce((maxSubgroup, currentSubgroup) => {
            const { totalGrouping, individualGroupings } = currentSubgroup;
            const { totalGrouping: maxTotalGrouping, individualGroupings: maxIndividualGroupings } = maxSubgroup;
            const maxOffset = maxTotalGrouping.declarationSize() - (maxIndividualGroupings.length * targetGrouping.selectorSize());
            const currentOffset = totalGrouping.declarationSize() - (individualGroupings.length * targetGrouping.selectorSize());
            if (maxOffset < currentOffset) {
                return currentSubgroup;
            }
            return maxSubgroup;
        }, subgroups[0]);
        targetGrouping.removeDeclarations(totalGrouping.declarations);
        individualGroupings.forEach((grouping) => {
            grouping.addSelectors(targetGrouping.selectors);
        });
    }
    return groupings;
}


function calcSize(groupings: CssGrouping []) {
    return groupings.reduce((acc, grouping) => acc + grouping.declarationSize() + grouping.selectorSize(), 0)
}
function test() {
    const ruleGroupings = getRuleGroupings(fakeStylesheet.stylesheet);
    const withSameGroupingsCombined = combineSameGroupings(ruleGroupings);
    console.log('with combined same groupings', withSameGroupingsCombined);
    console.log('total characters with same groupings', calcSize(withSameGroupingsCombined));
    const withSubsetsCombined = combineSubsets(withSameGroupingsCombined);
    console.log('with subset groupings combined', withSubsetsCombined);
    console.log('total characters with subsets combined', calcSize(withSubsetsCombined));
}

test();
