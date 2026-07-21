"""
Native-type bridge coverage
============================

Guards the Java/C++ native-type bridge (practice_starters.PRACTICE_ARG_SPECS +
the run_*_practice_tests bridges) against silent grading breaks: for every spec'd
function a KNOWN-CORRECT native-typed solution is run through the real runner and
must pass all of that function's authored test cases.

C++ covers every spec'd function (the harder marshalling path, where the bug
that started this work lived). Java covers one function per distinct signature
shape, since the marshalling is per-shape, not per-function.

Skipped automatically when g++/JDK aren't installed (e.g. CI), so this file is
safe to keep in the suite; run it locally with the compilers on PATH before deploy.
"""

import json
import shutil
from pathlib import Path

import pytest

from coding_runner import run_cpp_practice_tests, run_java_practice_tests
from practice_starters import get_arg_spec

_HAS_GPP = shutil.which("g++") is not None or shutil.which("clang++") is not None
_HAS_JAVA = shutil.which("javac") is not None and shutil.which("java") is not None

_ANSWERS = Path(__file__).resolve().parent.parent / "data_sources" / "quiz" / "answers" / "cpp.json"


def _load_tests():
    data = json.loads(_ANSWERS.read_text(encoding="utf-8"))
    defaults = data.get("defaults", {})
    out = {}
    for item in data.get("items", []):
        fn = item.get("function_name")
        tests = item.get("runner_tests") or item.get("tests") or defaults.get("tests") or []
        out[fn] = [t for t in tests if isinstance(t, dict)]
    return out


_TESTS = _load_tests()

# ── C++ reference solutions (native-typed, match PRACTICE_ARG_SPECS signatures) ──
_CPP_HEADER = "#include <bits/stdc++.h>\nusing namespace std;\n\n"

CPP_SOLUTIONS = {
    "alienDictionaryOrder": """string alienDictionaryOrder(vector<string> words){
    map<char,set<char>> g; map<char,int> indeg; set<char> chars;
    for(auto&w:words) for(char c:w){ chars.insert(c); if(!indeg.count(c)) indeg[c]=0; }
    for(size_t i=0;i+1<words.size();i++){
        string a=words[i], b=words[i+1]; size_t j=0; bool ok=false;
        for(;j<a.size()&&j<b.size();j++){ if(a[j]!=b[j]){ if(!g[a[j]].count(b[j])){ g[a[j]].insert(b[j]); indeg[b[j]]++; } ok=true; break; } }
        if(!ok && a.size()>b.size()) return "";
    }
    priority_queue<char,vector<char>,greater<char>> q;
    for(char c:chars) if(indeg[c]==0) q.push(c);
    string res;
    while(!q.empty()){ char c=q.top(); q.pop(); res+=c; for(char n:g[c]){ if(--indeg[n]==0) q.push(n); } }
    return res.size()==chars.size()?res:"";
}""",
    "balancedBrackets": """bool balancedBrackets(string text){
    stack<char> s; map<char,char> m={{')','('},{']','['},{'}','{'}};
    for(char c:text){ if(c=='('||c=='['||c=='{') s.push(c); else if(m.count(c)){ if(s.empty()||s.top()!=m[c]) return false; s.pop(); } }
    return s.empty();
}""",
    "binarySearchExact": """long long binarySearchExact(vector<long long> nums, long long target){
    int lo=0, hi=(int)nums.size()-1;
    while(lo<=hi){ int mid=lo+(hi-lo)/2; if(nums[mid]==target) return mid; if(nums[mid]<target) lo=mid+1; else hi=mid-1; }
    return -1;
}""",
    "binarySearchInsertPosition": """long long binarySearchInsertPosition(vector<long long> nums, long long target){
    int lo=0, hi=nums.size(); while(lo<hi){ int mid=(lo+hi)/2; if(nums[mid]<target) lo=mid+1; else hi=mid; } return lo;
}""",
    "canVote": """bool canVote(long long age){ return age>=18; }""",
    "clampScore": """long long clampScore(long long score){ return max(0LL,min(100LL,score)); }""",
    "compressRuns": """string compressRuns(string text){
    string r; for(size_t i=0;i<text.size();){ size_t j=i; while(j<text.size()&&text[j]==text[i]) j++; r+=text[i]; r+=to_string(j-i); i=j; } return r;
}""",
    "countDigits": """long long countDigits(long long n){
    if(n==0) return 1; long long c=0; while(n>0){ c++; n/=10; } return c;
}""",
    "countIslands": """long long countIslands(vector<vector<long long>> grid){
    int R=grid.size(); if(!R) return 0; int C=grid[0].size(); long long c=0;
    function<void(int,int)> dfs=[&](int r,int col){ if(r<0||col<0||r>=R||col>=C||grid[r][col]==0) return; grid[r][col]=0; dfs(r+1,col);dfs(r-1,col);dfs(r,col+1);dfs(r,col-1); };
    for(int r=0;r<R;r++) for(int col=0;col<C;col++) if(grid[r][col]==1){ c++; dfs(r,col); } return c;
}""",
    "countVowels": """long long countVowels(string text){ long long c=0; for(char ch:text){ char l=tolower(ch); if(string("aeiou").find(l)!=string::npos) c++; } return c; }""",
    "countWords": """long long countWords(string sentence){ istringstream is(sentence); string w; long long c=0; while(is>>w) c++; return c; }""",
    "coursePlanTopologicalOrder": """vector<string> coursePlanTopologicalOrder(vector<string> courses, vector<vector<string>> prereqs){
    map<string,set<string>> g; map<string,int> indeg; for(auto&c:courses) indeg[c]=0;
    for(auto&p:prereqs){ string course=p[0], pre=p[1]; if(!g[pre].count(course)){ g[pre].insert(course); indeg[course]++; } }
    priority_queue<string,vector<string>,greater<string>> q; for(auto&c:courses) if(indeg[c]==0) q.push(c);
    vector<string> res; while(!q.empty()){ string c=q.top(); q.pop(); res.push_back(c); for(auto&n:g[c]) if(--indeg[n]==0) q.push(n); }
    return res.size()==courses.size()?res:vector<string>{};
}""",
    "coursePrerequisiteChain": """bool coursePrerequisiteChain(vector<vector<string>> pairs, string course, string prereq){
    map<string,vector<string>> g; for(auto&p:pairs) g[p[0]].push_back(p[1]);
    set<string> seen; function<bool(string)> dfs=[&](string c)->bool{ if(c==prereq) return true; if(seen.count(c)) return false; seen.insert(c); for(auto&n:g[c]) if(dfs(n)) return true; return false; };
    return dfs(course);
}""",
    "decodeWays": """long long decodeWays(string digits){
    int n=digits.size(); if(n==0) return 0; vector<long long> dp(n+1,0); dp[0]=1; dp[1]=digits[0]=='0'?0:1;
    for(int i=2;i<=n;i++){ if(digits[i-1]!='0') dp[i]+=dp[i-1]; int two=stoi(digits.substr(i-2,2)); if(two>=10&&two<=26) dp[i]+=dp[i-2]; }
    return dp[n];
}""",
    "editDistance": """long long editDistance(string source, string target){
    int m=source.size(), n=target.size(); vector<vector<int>> dp(m+1,vector<int>(n+1,0));
    for(int i=0;i<=m;i++) dp[i][0]=i; for(int j=0;j<=n;j++) dp[0][j]=j;
    for(int i=1;i<=m;i++) for(int j=1;j<=n;j++) dp[i][j]=(source[i-1]==target[j-1])?dp[i-1][j-1]:1+min({dp[i-1][j],dp[i][j-1],dp[i-1][j-1]});
    return dp[m][n];
}""",
    "earliestConnectedTime": """long long earliestConnectedTime(long long n, vector<vector<long long>> events){
    sort(events.begin(),events.end()); vector<long long> p(n); iota(p.begin(),p.end(),0); long long comps=n;
    function<long long(long long)> find=[&](long long x){ while(p[x]!=x){ p[x]=p[p[x]]; x=p[x]; } return x; };
    for(auto&e:events){ long long ra=find(e[1]), rb=find(e[2]); if(ra!=rb){ p[ra]=rb; comps--; if(comps==1) return e[0]; } }
    return -1;
}""",
    "expressionEvaluator": """long long expressionEvaluator(string expression){
    vector<long long> nums; vector<char> ops; long long cur=0; char op='+';
    string s=expression; s+='+';
    auto apply=[&](){ };
    for(size_t i=0;i<s.size();i++){ char c=s[i]; if(isdigit(c)){ cur=cur*10+(c-'0'); } else if(c=='+'||c=='-'||c=='*'||c=='/'){
        if(op=='+') nums.push_back(cur); else if(op=='-') nums.push_back(-cur);
        else if(op=='*'){ long long t=nums.back(); nums.pop_back(); nums.push_back(t*cur); }
        else { long long t=nums.back(); nums.pop_back(); nums.push_back(t/cur); }
        op=c; cur=0; } }
    long long sum=0; for(auto x:nums) sum+=x; return sum;
}""",
    "firstMissingPositiveSmall": """long long firstMissingPositiveSmall(vector<long long> nums){
    set<long long> s(nums.begin(),nums.end()); long long i=1; while(s.count(i)) i++; return i;
}""",
    "gradeBucket": """string gradeBucket(long long score){
    if(score>=90) return "A"; if(score>=80) return "B"; if(score>=70) return "C"; if(score>=60) return "D"; return "F";
}""",
    "helpDeskQueue": """vector<string> helpDeskQueue(vector<string> commands){
    queue<string> q; vector<string> out;
    for(auto&cmd:commands){ if(cmd.rfind("join ",0)==0) q.push(cmd.substr(5)); else { if(q.empty()) out.push_back("none"); else { out.push_back(q.front()); q.pop(); } } }
    return out;
}""",
    "initials": """string initials(string fullName){
    istringstream is(fullName); string w, r; while(is>>w) if(!w.empty()) r+=toupper(w[0]); return r;
}""",
    "isPalindrome": """bool isPalindrome(string text){
    string s; for(char c:text) if(isalnum(c)) s+=tolower(c); string r(s.rbegin(),s.rend()); return s==r;
}""",
    "lastDigit": """long long lastDigit(long long number){ return llabs(number)%10; }""",
    "longestIncreasingSubsequenceLength": """long long longestIncreasingSubsequenceLength(vector<long long> nums){
    vector<long long> tails; for(long long x:nums){ auto it=lower_bound(tails.begin(),tails.end(),x); if(it==tails.end()) tails.push_back(x); else *it=x; } return tails.size();
}""",
    "longestUniqueWindow": """long long longestUniqueWindow(string text){
    map<char,int> last; int start=0; long long best=0;
    for(int i=0;i<(int)text.size();i++){ if(last.count(text[i])&&last[text[i]]>=start) start=last[text[i]]+1; last[text[i]]=i; best=max(best,(long long)(i-start+1)); }
    return best;
}""",
    "matrixRowSums": """vector<long long> matrixRowSums(vector<vector<long long>> matrix){
    vector<long long> r; for(auto&row:matrix){ long long s=0; for(auto v:row) s+=v; r.push_back(s); } return r;
}""",
    "matrixColumnSums": """vector<long long> matrixColumnSums(vector<vector<long long>> matrix){
    if(matrix.empty()) return {}; vector<long long> out(matrix[0].size(),0);
    for(auto&row:matrix) for(size_t c=0;c<row.size();c++) out[c]+=row[c];
    return out;
}""",
    "maximalSquare": """long long maximalSquare(vector<vector<long long>> matrix){
    int R=matrix.size(); if(!R) return 0; int C=matrix[0].size(); vector<vector<int>> dp(R+1,vector<int>(C+1,0)); int best=0;
    for(int i=1;i<=R;i++) for(int j=1;j<=C;j++) if(matrix[i-1][j-1]==1){ dp[i][j]=1+min({dp[i-1][j],dp[i][j-1],dp[i-1][j-1]}); best=max(best,dp[i][j]); }
    return (long long)best*best;
}""",
    "maximumSubarrayWithOneDeletion": """long long maximumSubarrayWithOneDeletion(vector<long long> nums){
    int n=nums.size(); vector<long long> nod(n), od(n); nod[0]=nums[0]; od[0]=nums[0]; long long best=nums[0];
    for(int i=1;i<n;i++){ nod[i]=max(nums[i],nod[i-1]+nums[i]); od[i]=max(od[i-1]+nums[i],nod[i-1]); best=max({best,nod[i],od[i]}); }
    return best;
}""",
    "maximumWindowSum": """long long maximumWindowSum(vector<long long> nums, long long k){
    long long cur=0; for(int i=0;i<k;i++) cur+=nums[i]; long long best=cur;
    for(int i=k;i<(int)nums.size();i++){ cur+=nums[i]-nums[i-k]; best=max(best,cur); }
    return best;
}""",
    "mergeNames": """vector<string> mergeNames(vector<string> firstNames, vector<string> secondNames){
    vector<string> r=firstNames; for(auto&s:secondNames) r.push_back(s); return r;
}""",
    "mergeOverlappingIntervals": """vector<vector<long long>> mergeOverlappingIntervals(vector<vector<long long>> intervals){
    if(intervals.empty()) return {}; sort(intervals.begin(),intervals.end()); vector<vector<long long>> out{intervals[0]};
    for(size_t i=1;i<intervals.size();i++){ if(intervals[i][0]<=out.back()[1]) out.back()[1]=max(out.back()[1],intervals[i][1]); else out.push_back(intervals[i]); }
    return out;
}""",
    "mergeSortedLists": """vector<long long> mergeSortedLists(vector<long long> left, vector<long long> right){
    vector<long long> r; merge(left.begin(),left.end(),right.begin(),right.end(),back_inserter(r)); return r;
}""",
    "minStackOperations": """vector<long long> minStackOperations(vector<string> commands){
    vector<long long> st, mins, out;
    for(auto&cmd:commands){ istringstream is(cmd); string op; is>>op;
        if(op=="push"){ long long v; is>>v; st.push_back(v); mins.push_back(mins.empty()?v:min(mins.back(),v)); }
        else if(op=="pop"){ if(!st.empty()){ st.pop_back(); mins.pop_back(); } }
        else if(op=="min"){ if(!mins.empty()) out.push_back(mins.back()); }
        else if(op=="top"){ if(!st.empty()) out.push_back(st.back()); } }
    return out;
}""",
    "minimumMeetingRooms": """long long minimumMeetingRooms(vector<vector<long long>> intervals){
    vector<long long> starts, ends; for(auto&iv:intervals){ starts.push_back(iv[0]); ends.push_back(iv[1]); }
    sort(starts.begin(),starts.end()); sort(ends.begin(),ends.end());
    long long rooms=0, best=0; size_t i=0,j=0; while(i<starts.size()){ if(starts[i]<ends[j]){ rooms++; i++; best=max(best,rooms); } else { rooms--; j++; } } return best;
}""",
    "normalizeEmailList": """vector<string> normalizeEmailList(vector<string> emails){
    vector<string> r; set<string> seen; for(auto e:emails){ string t; for(char c:e) if(!isspace(c)) t+=tolower(c); if(!seen.count(t)){ seen.insert(t); r.push_back(t); } } return r;
}""",
    "pairSumSorted": """bool pairSumSorted(vector<long long> nums, long long target){
    int l=0, r=(int)nums.size()-1; while(l<r){ long long s=nums[l]+nums[r]; if(s==target) return true; if(s<target) l++; else r--; } return false;
}""",
    "prefixSearch": """vector<string> prefixSearch(vector<string> words, string prefix){
    vector<string> r; for(auto&w:words) if(w.size()>=prefix.size()&&w.compare(0,prefix.size(),prefix)==0) r.push_back(w); return r;
}""",
    "rangeSumQueries": """vector<long long> rangeSumQueries(vector<long long> nums, vector<vector<long long>> queries){
    vector<long long> pref{0}, out; for(long long x:nums) pref.push_back(pref.back()+x);
    for(auto&q:queries) out.push_back(pref[q[1]+1]-pref[q[0]]);
    return out;
}""",
    "removeDuplicatesKeepOrder": """vector<long long> removeDuplicatesKeepOrder(vector<long long> nums){
    vector<long long> r; set<long long> seen; for(long long x:nums) if(!seen.count(x)){ seen.insert(x); r.push_back(x); } return r;
}""",
    "recursiveDigitSum": """long long recursiveDigitSum(long long n){
    if(n<10) return n; return n%10 + recursiveDigitSum(n/10);
}""",
    "reverseWords": """string reverseWords(string sentence){
    istringstream is(sentence); vector<string> w; string t; while(is>>t) w.push_back(t); reverse(w.begin(),w.end());
    string r; for(size_t i=0;i<w.size();i++){ if(i) r+=" "; r+=w[i]; } return r;
}""",
    "rotateListRight": """vector<long long> rotateListRight(vector<long long> items, long long k){
    int n=items.size(); if(!n) return items; k%=n; vector<long long> r; for(int i=0;i<n;i++) r.push_back(items[(i-k+n)%n]); return r;
}""",
    "runningTotal": """vector<long long> runningTotal(vector<long long> nums){
    vector<long long> r; long long s=0; for(long long x:nums){ s+=x; r.push_back(s); } return r;
}""",
    "shortestPathInCampusGrid": """long long shortestPathInCampusGrid(vector<vector<string>> grid){
    int R=grid.size(); if(!R) return -1; int C=grid[0].size(); int sr=0,sc=0;
    for(int i=0;i<R;i++) for(int j=0;j<C;j++) if(grid[i][j]=="S"){ sr=i; sc=j; }
    vector<vector<int>> dist(R,vector<int>(C,-1)); queue<pair<int,int>> q; q.push(make_pair(sr,sc)); dist[sr][sc]=0;
    int dr[]={1,-1,0,0}, dc[]={0,0,1,-1};
    while(!q.empty()){ int r=q.front().first, c=q.front().second; q.pop(); if(grid[r][c]=="T") return dist[r][c];
        for(int d=0;d<4;d++){ int nr=r+dr[d],nc=c+dc[d]; if(nr<0||nc<0||nr>=R||nc>=C||grid[nr][nc]=="#"||dist[nr][nc]!=-1) continue; dist[nr][nc]=dist[r][c]+1; q.push(make_pair(nr,nc)); } }
    return -1;
}""",
    "subarraySumEqualsK": """long long subarraySumEqualsK(vector<long long> nums, long long k){
    map<long long,long long> cnt; cnt[0]=1; long long sum=0, res=0; for(long long x:nums){ sum+=x; res+=cnt[sum-k]; cnt[sum]++; } return res;
}""",
    "sumEvenNumbers": """long long sumEvenNumbers(vector<long long> nums){ long long s=0; for(long long x:nums) if(x%2==0) s+=x; return s; }""",
    "temperatureAboveThreshold": """long long temperatureAboveThreshold(vector<long long> readings, long long threshold){
    long long c=0; for(long long x:readings) if(x>threshold) c++; return c;
}""",
    "topKScores": """vector<long long> topKScores(vector<long long> scores, long long k){
    sort(scores.begin(),scores.end(),greater<long long>()); scores.resize(k); return scores;
}""",
    "topKFrequent": """vector<long long> topKFrequent(vector<long long> items, long long k){
    map<long long,long long> cnt; vector<long long> order; for(long long x:items){ if(!cnt.count(x)) order.push_back(x); cnt[x]++; }
    stable_sort(order.begin(),order.end(),[&](long long a,long long b){ return cnt[a]>cnt[b]; });
    vector<long long> r; for(int i=0;i<k&&i<(int)order.size();i++) r.push_back(order[i]); return r;
}""",
    "treeLevelSums": """vector<long long> treeLevelSums(vector<long long> tree){
    vector<long long> out; for(size_t idx=0, width=1; idx<tree.size(); idx+=width, width*=2){ long long sum=0; for(size_t i=idx;i<tree.size()&&i<idx+width;i++) if(tree[i]!=-1) sum+=tree[i]; out.push_back(sum); } return out;
}""",
    "triePrefixCounts": """vector<long long> triePrefixCounts(vector<string> commands){
    vector<string> words; vector<long long> out;
    for(auto&cmd:commands){ istringstream is(cmd); string op,arg; is>>op>>arg;
        if(op=="insert") words.push_back(arg);
        else { long long c=0; for(auto&w:words) if(w.size()>=arg.size()&&w.compare(0,arg.size(),arg)==0) c++; out.push_back(c); } }
    return out;
}""",
    "twoSumIndexes": """vector<long long> twoSumIndexes(vector<long long> nums, long long target){
    map<long long,long long> seen; for(int i=0;i<(int)nums.size();i++){ if(seen.count(target-nums[i])) return {seen[target-nums[i]],(long long)i}; seen[nums[i]]=i; } return {};
}""",
    "unionFindComponents": """long long unionFindComponents(long long n, vector<vector<long long>> pairs){
    vector<long long> p(n); for(long long i=0;i<n;i++) p[i]=i;
    function<long long(long long)> find=[&](long long x){ while(p[x]!=x){ p[x]=p[p[x]]; x=p[x]; } return x; };
    for(auto&e:pairs){ p[find(e[0])]=find(e[1]); } set<long long> roots; for(long long i=0;i<n;i++) roots.insert(find(i)); return roots.size();
}""",
    "uniqueCount": """long long uniqueCount(vector<long long> nums){
    set<long long> seen(nums.begin(),nums.end()); return seen.size();
}""",
    "validCourseCodeShape": """bool validCourseCodeShape(string code){
    // 4 uppercase letters, optional single space, then 3 digits (e.g. "COSC 220" or "MATH241").
    string s; for(char c:code) if(c!=' ') s+=c;  // allow at most one space, checked below
    int spaces=0; for(char c:code) if(c==' ') spaces++;
    if(spaces>1) return false;
    if(s.size()!=7) return false;
    for(int i=0;i<4;i++) if(!isupper((unsigned char)s[i])) return false;
    for(int i=4;i<7;i++) if(!isdigit((unsigned char)s[i])) return false;
    return true;
}""",
    "validStudySchedule": """bool validStudySchedule(vector<vector<long long>> intervals){
    sort(intervals.begin(),intervals.end()); for(size_t i=1;i<intervals.size();i++) if(intervals[i][0]<intervals[i-1][1]) return false; return true;
}""",
    "wordLadderSteps": """long long wordLadderSteps(string start, string end, vector<string> dictionary){
    set<string> dict(dictionary.begin(),dictionary.end()); if(!dict.count(end)) return 0;
    queue<pair<string,int>> q; q.push({start,1}); set<string> seen; seen.insert(start);
    while(!q.empty()){ auto [w,d]=q.front(); q.pop(); if(w==end) return d;
        for(size_t i=0;i<w.size();i++){ string nw=w; for(char c='a';c<='z';c++){ nw[i]=c; if(dict.count(nw)&&!seen.count(nw)){ seen.insert(nw); q.push({nw,d+1}); } } } }
    return 0;
}""",
    "anyWordHasPrefix": """bool anyWordHasPrefix(vector<string> words, string prefix){
    for(auto&w:words) if(w.size()>=prefix.size()&&w.compare(0,prefix.size(),prefix)==0) return true;
    return false;
}""",
}


@pytest.mark.skipif(not _HAS_GPP, reason="no C++ compiler on PATH")
@pytest.mark.parametrize("fn", sorted(CPP_SOLUTIONS))
def test_cpp_native_bridge_solution_passes(fn):
    spec = get_arg_spec(fn)
    assert spec is not None, f"{fn} lost its arg spec"
    tests = _TESTS.get(fn) or []
    assert tests, f"{fn} has no tests to check"
    code = _CPP_HEADER + CPP_SOLUTIONS[fn]
    result = run_cpp_practice_tests(code, fn, tests, arg_spec=spec)
    assert result["status"] == "passed", (
        f"{fn}: {result.get('passed')}/{result.get('total')} "
        f"stderr={result.get('stderr','')[:300]} "
        f"tests={result.get('tests')}"
    )


def test_cpp_solutions_cover_every_spec_function():
    """Every native-bridge (spec'd) function must have a reference solution here,
    so adding a function without covering it fails loudly."""
    data = json.loads(_ANSWERS.read_text(encoding="utf-8"))
    spec_fns = {it["function_name"] for it in data.get("items", []) if get_arg_spec(it.get("function_name"))}
    missing = spec_fns - set(CPP_SOLUTIONS)
    assert not missing, f"spec'd functions without a C++ reference solution: {sorted(missing)}"


# ── Java: one solution per distinct signature shape (marshalling is per-shape) ──
JAVA_SOLUTIONS = {
    # string -> int
    "countVowels": "class Solution { static int countVowels(String text){ int c=0; for(char ch:text.toLowerCase().toCharArray()) if(\"aeiou\".indexOf(ch)>=0) c++; return c; } }",
    # string -> bool
    "isPalindrome": "class Solution { static boolean isPalindrome(String text){ StringBuilder b=new StringBuilder(); for(char c:text.toCharArray()) if(Character.isLetterOrDigit(c)) b.append(Character.toLowerCase(c)); String s=b.toString(); return s.equals(b.reverse().toString()); } }",
    # string -> string
    "reverseWords": "import java.util.*; class Solution { static String reverseWords(String sentence){ String[] w=sentence.trim().split(\"\\\\s+\"); List<String> l=new ArrayList<>(Arrays.asList(w)); Collections.reverse(l); return String.join(\" \", l); } }",
    # int -> int
    "clampScore": "class Solution { static int clampScore(int score){ return Math.max(0, Math.min(100, score)); } }",
    # int -> bool
    "canVote": "class Solution { static boolean canVote(int age){ return age >= 18; } }",
    # int -> string
    "gradeBucket": "class Solution { static String gradeBucket(int score){ if(score>=90) return \"A\"; if(score>=80) return \"B\"; if(score>=70) return \"C\"; if(score>=60) return \"D\"; return \"F\"; } }",
    # intlist -> int
    "sumEvenNumbers": "class Solution { static int sumEvenNumbers(int[] nums){ int s=0; for(int x:nums) if(x%2==0) s+=x; return s; } }",
    # intlist -> intlist
    "runningTotal": "class Solution { static int[] runningTotal(int[] nums){ int[] r=new int[nums.length]; int s=0; for(int i=0;i<nums.length;i++){ s+=nums[i]; r[i]=s; } return r; } }",
    # intlist,int -> int
    "temperatureAboveThreshold": "class Solution { static int temperatureAboveThreshold(int[] readings, int threshold){ int c=0; for(int x:readings) if(x>threshold) c++; return c; } }",
    # intlist,int -> bool
    "pairSumSorted": "class Solution { static boolean pairSumSorted(int[] nums, int target){ int l=0,r=nums.length-1; while(l<r){ int s=nums[l]+nums[r]; if(s==target) return true; if(s<target) l++; else r--; } return false; } }",
    # intlist,int -> intlist
    "twoSumIndexes": "import java.util.*; class Solution { static int[] twoSumIndexes(int[] nums, int target){ Map<Integer,Integer> m=new HashMap<>(); for(int i=0;i<nums.length;i++){ if(m.containsKey(target-nums[i])) return new int[]{m.get(target-nums[i]), i}; m.put(nums[i], i); } return new int[0]; } }",
    # strlist -> strlist
    "normalizeEmailList": "import java.util.*; class Solution { static String[] normalizeEmailList(String[] emails){ List<String> r=new ArrayList<>(); Set<String> seen=new HashSet<>(); for(String e:emails){ String t=e.replaceAll(\"\\\\s\",\"\").toLowerCase(); if(seen.add(t)) r.add(t); } return r.toArray(new String[0]); } }",
    # strlist,string -> bool
    "anyWordHasPrefix": "class Solution { static boolean anyWordHasPrefix(String[] words, String prefix){ for(String w:words) if(w.startsWith(prefix)) return true; return false; } }",
    # strlist,string -> strlist
    "prefixSearch": "import java.util.*; class Solution { static String[] prefixSearch(String[] words, String prefix){ List<String> r=new ArrayList<>(); for(String w:words) if(w.startsWith(prefix)) r.add(w); return r.toArray(new String[0]); } }",
    # grid -> int
    "countIslands": "class Solution { static int countIslands(int[][] grid){ int R=grid.length; if(R==0) return 0; int C=grid[0].length; int c=0; for(int i=0;i<R;i++) for(int j=0;j<C;j++) if(grid[i][j]==1){ c++; dfs(grid,i,j,R,C); } return c; } static void dfs(int[][] g,int r,int col,int R,int C){ if(r<0||col<0||r>=R||col>=C||g[r][col]==0) return; g[r][col]=0; dfs(g,r+1,col,R,C);dfs(g,r-1,col,R,C);dfs(g,r,col+1,R,C);dfs(g,r,col-1,R,C); } }",
    # grid -> intlist
    "matrixRowSums": "class Solution { static int[] matrixRowSums(int[][] matrix){ int[] r=new int[matrix.length]; for(int i=0;i<matrix.length;i++){ int s=0; for(int v:matrix[i]) s+=v; r[i]=s; } return r; } }",
    # grid -> grid
    "mergeOverlappingIntervals": "import java.util.*; class Solution { static int[][] mergeOverlappingIntervals(int[][] intervals){ if(intervals.length==0) return new int[0][0]; Arrays.sort(intervals, Comparator.comparingInt(a -> a[0])); List<int[]> out=new ArrayList<>(); out.add(intervals[0].clone()); for(int i=1;i<intervals.length;i++){ int[] last=out.get(out.size()-1); if(intervals[i][0]<=last[1]) last[1]=Math.max(last[1], intervals[i][1]); else out.add(intervals[i].clone()); } return out.toArray(new int[out.size()][]); } }",
    # string,string -> int
    "editDistance": "class Solution { static int editDistance(String source, String target){ int m=source.length(), n=target.length(); int[][] dp=new int[m+1][n+1]; for(int i=0;i<=m;i++) dp[i][0]=i; for(int j=0;j<=n;j++) dp[0][j]=j; for(int i=1;i<=m;i++) for(int j=1;j<=n;j++) dp[i][j]=(source.charAt(i-1)==target.charAt(j-1))?dp[i-1][j-1]:1+Math.min(dp[i-1][j],Math.min(dp[i][j-1],dp[i-1][j-1])); return dp[m][n]; } }",
    # int,grid -> int
    "unionFindComponents": "import java.util.*; class Solution { static int[] par; static int find(int x){ while(par[x]!=x){ par[x]=par[par[x]]; x=par[x]; } return x; } static int unionFindComponents(int n, int[][] pairs){ par=new int[n]; for(int i=0;i<n;i++) par[i]=i; for(int[] e:pairs) par[find(e[0])]=find(e[1]); Set<Integer> s=new HashSet<>(); for(int i=0;i<n;i++) s.add(find(i)); return s.size(); } }",
    # strgrid -> int (string grid)
    "shortestPathInCampusGrid": "import java.util.*; class Solution { static int shortestPathInCampusGrid(String[][] grid){ int R=grid.length; if(R==0) return -1; int C=grid[0].length; int sr=0,sc=0; for(int i=0;i<R;i++) for(int j=0;j<C;j++) if(grid[i][j].equals(\"S\")){ sr=i; sc=j; } int[][] dist=new int[R][C]; for(int[] row:dist) Arrays.fill(row,-1); Deque<int[]> q=new ArrayDeque<>(); q.add(new int[]{sr,sc}); dist[sr][sc]=0; int[] dr={1,-1,0,0}, dc={0,0,1,-1}; while(!q.isEmpty()){ int[] cur=q.poll(); int r=cur[0],c=cur[1]; if(grid[r][c].equals(\"T\")) return dist[r][c]; for(int d=0;d<4;d++){ int nr=r+dr[d],nc=c+dc[d]; if(nr<0||nc<0||nr>=R||nc>=C||grid[nr][nc].equals(\"#\")||dist[nr][nc]!=-1) continue; dist[nr][nc]=dist[r][c]+1; q.add(new int[]{nr,nc}); } } return -1; } }",
    # strgrid,string,string -> bool
    "coursePrerequisiteChain": "import java.util.*; class Solution { static Map<String,List<String>> g; static Set<String> seen; static boolean dfs(String c, String prereq){ if(c.equals(prereq)) return true; if(!seen.add(c)) return false; for(String n:g.getOrDefault(c,new ArrayList<>())) if(dfs(n,prereq)) return true; return false; } static boolean coursePrerequisiteChain(String[][] pairs, String course, String prereq){ g=new HashMap<>(); seen=new HashSet<>(); for(String[] p:pairs) g.computeIfAbsent(p[0],k->new ArrayList<>()).add(p[1]); return dfs(course,prereq); } }",
}


@pytest.mark.skipif(not _HAS_JAVA, reason="no JDK on PATH")
@pytest.mark.parametrize("fn", sorted(JAVA_SOLUTIONS))
def test_java_native_bridge_solution_passes(fn):
    spec = get_arg_spec(fn)
    assert spec is not None, f"{fn} lost its arg spec"
    tests = _TESTS.get(fn) or []
    assert tests, f"{fn} has no tests to check"
    result = run_java_practice_tests(JAVA_SOLUTIONS[fn], fn, tests, arg_spec=spec)
    assert result["status"] == "passed", (
        f"{fn}: {result.get('passed')}/{result.get('total')} "
        f"stderr={result.get('stderr','')[:300]} "
        f"tests={result.get('tests')}"
    )
