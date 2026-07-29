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

from coding_runner import _camel_to_snake_name, _cpp_beginner_compat_adapter, run_cpp_practice_tests, run_java_practice_tests
from practice_starters import build_starter_from_spec, cpp_native_bridge, cpp_native_signature, get_arg_spec

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
    "firstBadVersion": """long long firstBadVersion(vector<long long> versions){
    int lo=0, hi=(int)versions.size()-1, ans=-1;
    while(lo<=hi){ int mid=lo+(hi-lo)/2; if(versions[mid]==1){ ans=mid; hi=mid-1; } else lo=mid+1; }
    return ans;
}""",
    "firstMissingPositiveSmall": """long long firstMissingPositiveSmall(vector<long long> nums){
    set<long long> s(nums.begin(),nums.end()); long long i=1; while(s.count(i)) i++; return i;
}""",
    "firstScoreAtLeast": """long long firstScoreAtLeast(vector<long long> scores, long long target){
    int lo=0, hi=(int)scores.size()-1, ans=-1;
    while(lo<=hi){ int mid=lo+(hi-lo)/2; if(scores[mid]>=target){ ans=mid; hi=mid-1; } else lo=mid+1; }
    return ans;
}""",
    "followLinkedListValues": """vector<long long> followLinkedListValues(vector<long long> values, vector<long long> nextIndexes, long long head){
    vector<long long> out; long long cur=head;
    while(cur!=-1){ out.push_back(values[cur]); cur=nextIndexes[cur]; }
    return out;
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
    "linkedListHasCycle": """bool linkedListHasCycle(vector<long long> nextIndexes, long long head){
    set<long long> seen; long long cur=head;
    while(cur!=-1){ if(seen.count(cur)) return true; seen.insert(cur); cur=nextIndexes[cur]; }
    return false;
}""",
    "linkedListMiddleValue": """long long linkedListMiddleValue(vector<long long> values, vector<long long> nextIndexes, long long head){
    if(head==-1) return -1; vector<long long> order; long long cur=head;
    while(cur!=-1){ order.push_back(values[cur]); cur=nextIndexes[cur]; }
    return order[order.size()/2];
}""",
    "longestIncreasingSubsequenceLength": """long long longestIncreasingSubsequenceLength(vector<long long> nums){
    vector<long long> tails; for(long long x:nums){ auto it=lower_bound(tails.begin(),tails.end(),x); if(it==tails.end()) tails.push_back(x); else *it=x; } return tails.size();
}""",
    "longestUniqueWindow": """long long longestUniqueWindow(string text){
    map<char,int> last; int start=0; long long best=0;
    for(int i=0;i<(int)text.size();i++){ if(last.count(text[i])&&last[text[i]]>=start) start=last[text[i]]+1; last[text[i]]=i; best=max(best,(long long)(i-start+1)); }
    return best;
}""",
    "lowestCommonAncestorValue": """long long lowestCommonAncestorValue(vector<long long> tree, long long a, long long b){
    map<long long,long long> pos; for(int i=0;i<(int)tree.size();i++) if(tree[i]!=-1) pos[tree[i]]=i;
    long long ia=pos[a], ib=pos[b]; set<long long> seen;
    while(ia>=0){ seen.insert(ia); if(ia==0) break; ia=(ia-1)/2; }
    while(!seen.count(ib)){ ib=(ib-1)/2; }
    return tree[ib];
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
    "maxPlateStackHeight": """long long maxPlateStackHeight(vector<string> commands){
    long long cur=0, best=0; for(auto&cmd:commands){ if(cmd=="push") cur++; else if(cmd=="pop" && cur>0) cur--; best=max(best,cur); } return best;
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
    "recentQueueCounts": """vector<long long> recentQueueCounts(vector<long long> times, long long window){
    queue<long long> q; vector<long long> out;
    for(long long t:times){ q.push(t); while(!q.empty() && t-q.front()>window) q.pop(); out.push_back(q.size()); }
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
    "reverseLinkedListValues": """vector<long long> reverseLinkedListValues(vector<long long> values, vector<long long> nextIndexes, long long head){
    vector<long long> out; long long cur=head;
    while(cur!=-1){ out.push_back(values[cur]); cur=nextIndexes[cur]; }
    reverse(out.begin(), out.end()); return out;
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
    "serveFirstStudents": """vector<string> serveFirstStudents(vector<string> names, long long serveCount){
    vector<string> out; for(int i=0;i<(int)names.size() && i<serveCount;i++) out.push_back(names[i]); return out;
}""",
    "subarraySumEqualsK": """long long subarraySumEqualsK(vector<long long> nums, long long k){
    map<long long,long long> cnt; cnt[0]=1; long long sum=0, res=0; for(long long x:nums){ sum+=x; res+=cnt[sum-k]; cnt[sum]++; } return res;
}""",
    "sumEvenNumbers": """long long sumEvenNumbers(vector<long long> nums){ long long s=0; for(long long x:nums) if(x%2==0) s+=x; return s; }""",
    "dailyTemperatureWaits": """vector<long long> dailyTemperatureWaits(vector<long long> temperatures){
    vector<long long> ans(temperatures.size(),0), st;
    for(int i=0;i<(int)temperatures.size();i++){ while(!st.empty() && temperatures[i]>temperatures[st.back()]){ int j=st.back(); st.pop_back(); ans[j]=i-j; } st.push_back(i); }
    return ans;
}""",
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
    "treePathSumCount": """long long treePathSumCount(vector<long long> tree, long long target){
    if(tree.empty()) return 0; long long count=0;
    function<void(int,long long)> dfs=[&](int i,long long sum){
        if(i>=(int)tree.size() || tree[i]==-1) return;
        sum += tree[i]; int l=2*i+1, r=2*i+2;
        bool leftReal = l<(int)tree.size() && tree[l]!=-1;
        bool rightReal = r<(int)tree.size() && tree[r]!=-1;
        if(!leftReal && !rightReal){ if(sum==target) count++; return; }
        dfs(l,sum); dfs(r,sum);
    };
    dfs(0,0); return count;
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
    "countdownList": """vector<long long> countdownList(long long n){
    vector<long long> out; for(long long x=n; x>=0; x--) out.push_back(x); return out;
}""",
    "courseCreditTotal": """long long courseCreditTotal(vector<string> courses, vector<long long> credits, vector<string> selectedCourses){
    map<string,long long> lookup; for(size_t i=0;i<courses.size();i++) lookup[courses[i]]=credits[i];
    long long total=0; for(auto& course:selectedCourses) if(lookup.count(course)) total+=lookup[course];
    return total;
}""",
    "favoriteCourseCounts": """vector<long long> favoriteCourseCounts(vector<string> favorites, vector<string> targets){
    map<string,long long> counts; for(auto& favorite:favorites) counts[favorite]++;
    vector<long long> out; for(auto& target:targets) out.push_back(counts[target]);
    return out;
}""",
    "groceryPriceLookup": """long long groceryPriceLookup(vector<string> items, vector<long long> prices, string target){
    for(size_t i=0;i<items.size();i++) if(items[i]==target) return prices[i];
    return -1;
}""",
    "lateAssignmentPenalty": """long long lateAssignmentPenalty(long long score, long long daysLate){
    return max(0LL, score - daysLate * 5);
}""",
    "pairNamesWithScores": """vector<string> pairNamesWithScores(vector<string> names, vector<long long> scores){
    vector<string> out; for(size_t i=0;i<names.size();i++) out.push_back(names[i]+":"+to_string(scores[i]));
    return out;
}""",
    "parkingTicketTotal": """long long parkingTicketTotal(string day, long long hour, long long minutesParked, bool hasPermit){
    if(day=="Saturday" || day=="Sunday") return 0;
    if(hour < 7 || hour >= 19) return 0;
    if(day=="Wednesday" && (hour==12 || hour==13)) return 0;
    long long total = 20;
    if(minutesParked > 120) total += 10;
    if(!hasPermit && hour >= 9 && hour <= 16 && !(day=="Friday" && hour >= 15)) total += 15;
    return total;
}""",
    "plantWateringMessage": """string plantWateringMessage(long long moisture, bool isSunny){
    return (moisture < 30 || (isSunny && moisture < 45)) ? "water today" : "check tomorrow";
}""",
    "sharedStudyTopics": """vector<string> sharedStudyTopics(vector<string> firstTopics, vector<string> secondTopics){
    set<string> second(secondTopics.begin(), secondTopics.end()), used; vector<string> out;
    for(auto& topic:firstTopics) if(second.count(topic) && !used.count(topic)){ used.insert(topic); out.push_back(topic); }
    return out;
}""",
    "swapPairOrder": """vector<string> swapPairOrder(vector<string> pairItems){
    if(pairItems.size() < 2) return pairItems;
    return {pairItems[1], pairItems[0]};
}""",
    "temperatureComfortCount": """long long temperatureComfortCount(vector<long long> readings, long long low, long long high){
    long long count=0; for(long long reading:readings) if(reading>=low && reading<=high) count++;
    return count;
}""",
    "uniqueParkingZones": """long long uniqueParkingZones(vector<string> zones){
    set<string> seen(zones.begin(), zones.end()); return seen.size();
}""",
    "weeklyPlantCareDays": """vector<string> weeklyPlantCareDays(vector<long long> moistureReadings, long long threshold){
    vector<string> days={"Mon","Tue","Wed","Thu","Fri","Sat","Sun"}, out;
    for(size_t i=0;i<moistureReadings.size() && i<days.size();i++) if(moistureReadings[i]<threshold) out.push_back(days[i]);
    return out;
}""",
    "edgePairMatches": """long long edgePairMatches(vector<string> words){
    long long count=0; int left=0, right=(int)words.size()-1;
    while(left<right){ if(words[left]==words[right]) count++; left++; right--; }
    return count;
}""",
    "countShortStudyBlocks": """long long countShortStudyBlocks(vector<long long> minutes, long long limit){
    long long count=0; for(size_t i=1;i<minutes.size();i++) if(minutes[i-1]+minutes[i] <= limit) count++;
    return count;
}""",
    "recursiveFactorialSmall": """long long recursiveFactorialSmall(long long n){
    if(n<=1) return 1;
    return n * recursiveFactorialSmall(n-1);
}""",
    "reverseOnlyLetters": """string reverseOnlyLetters(string text){
    int left=0, right=(int)text.size()-1;
    while(left<right){
        while(left<right && !isalpha((unsigned char)text[left])) left++;
        while(left<right && !isalpha((unsigned char)text[right])) right--;
        if(left<right) swap(text[left++], text[right--]);
    }
    return text;
}""",
    "minimumStudyWindow": """long long minimumStudyWindow(vector<long long> minutes, long long target){
    long long best=LLONG_MAX, sum=0; size_t left=0;
    for(size_t right=0; right<minutes.size(); right++){
        sum += minutes[right];
        while(sum >= target){ best = min(best, (long long)(right-left+1)); sum -= minutes[left++]; }
    }
    return best==LLONG_MAX ? 0 : best;
}""",
    "recursivePower": """long long recursivePower(long long base, long long exponent){
    if(exponent==0) return 1;
    return base * recursivePower(base, exponent-1);
}""",
    "stackTopAfterPlates": """string stackTopAfterPlates(vector<string> commands){
    vector<string> st;
    for(auto& cmd:commands){ if(cmd.rfind("push ",0)==0) st.push_back(cmd.substr(5)); else if(cmd=="pop" && !st.empty()) st.pop_back(); }
    return st.empty() ? "none" : st.back();
}""",
    "queueFrontAfterServes": """string queueFrontAfterServes(vector<string> names, long long serveCount){
    return serveCount >= (long long)names.size() ? "none" : names[serveCount];
}""",
    "firstOneIndex": """long long firstOneIndex(vector<long long> flags){
    long long left=0, right=(long long)flags.size()-1, ans=-1;
    while(left<=right){ long long mid=left+(right-left)/2; if(flags[mid]==1){ ans=mid; right=mid-1; } else left=mid+1; }
    return ans;
}""",
    "treeNodeCount": """long long treeNodeCount(vector<long long> tree){
    long long count=0; for(long long value:tree) if(value!=-1) count++; return count;
}""",
    "treeHeightLevels": """long long treeHeightLevels(vector<long long> tree){
    long long height=0;
    for(size_t i=0;i<tree.size();i++){
        if(tree[i]==-1) continue;
        long long level=0;
        size_t pos=i+1;
        while(pos>0){ level++; pos/=2; }
        height=max(height, level);
    }
    return height;
}""",
    "linkedListLength": """long long linkedListLength(vector<long long> nextIndexes, long long head){
    long long count=0, cur=head; while(cur!=-1){ count++; cur=nextIndexes[cur]; } return count;
}""",
    "treeLeafCount": """long long treeLeafCount(vector<long long> tree){
    long long count=0; for(size_t i=0;i<tree.size();i++){ if(tree[i]==-1) continue; size_t l=2*i+1, r=2*i+2; bool left=l<tree.size() && tree[l]!=-1, right=r<tree.size() && tree[r]!=-1; if(!left && !right) count++; } return count;
}""",
    "treeContainsValue": """bool treeContainsValue(vector<long long> tree, long long target){
    for(long long value:tree) if(value!=-1 && value==target) return true; return false;
}""",
    "linkedListMergeIndex": """long long linkedListMergeIndex(vector<long long> nextIndexes, long long headA, long long headB){
    set<long long> seen; for(long long cur=headA; cur!=-1; cur=nextIndexes[cur]) seen.insert(cur);
    for(long long cur=headB; cur!=-1; cur=nextIndexes[cur]) if(seen.count(cur)) return cur;
    return -1;
}""",
    "campusStopReachable": """bool campusStopReachable(vector<vector<string>> connections, string start, string target){
    if(start==target) return true;
    map<string, vector<string>> graph; for(auto& edge:connections) if(edge.size()>=2) graph[edge[0]].push_back(edge[1]);
    queue<string> q; set<string> seen; q.push(start); seen.insert(start);
    while(!q.empty()){ string cur=q.front(); q.pop(); for(auto& next:graph[cur]){ if(next==target) return true; if(!seen.count(next)){ seen.insert(next); q.push(next); } } }
    return false;
}""",
    "clubMembershipGroups": """long long clubMembershipGroups(long long n, vector<vector<long long>> pairs){
    vector<long long> parent(n); iota(parent.begin(), parent.end(), 0);
    function<long long(long long)> find=[&](long long x){ while(parent[x]!=x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; };
    for(auto& p:pairs) if(p.size()>=2) parent[find(p[0])] = find(p[1]);
    set<long long> groups; for(long long i=0;i<n;i++) groups.insert(find(i)); return groups.size();
}""",
    "minStudyPlanCost": """long long minStudyPlanCost(vector<long long> costs){
    if(costs.empty()) return 0; if(costs.size()==1) return costs[0];
    long long prev2=costs[0], prev1=costs[1];
    for(size_t i=2;i<costs.size();i++){ long long cur=min(prev1, prev2)+costs[i]; prev2=prev1; prev1=cur; }
    return min(prev1, prev2);
}""",
    "prefixMatchCount": """long long prefixMatchCount(vector<string> words, string prefix){
    long long count=0; for(auto& word:words) if(word.size()>=prefix.size() && word.compare(0, prefix.size(), prefix)==0) count++;
    return count;
}""",
    "redundantFriendshipEdge": """vector<long long> redundantFriendshipEdge(long long n, vector<vector<long long>> pairs){
    vector<long long> parent(n); iota(parent.begin(), parent.end(), 0);
    function<long long(long long)> find=[&](long long x){ while(parent[x]!=x){ parent[x]=parent[parent[x]]; x=parent[x]; } return x; };
    for(auto& p:pairs){ long long a=find(p[0]), b=find(p[1]); if(a==b) return {p[0], p[1]}; parent[a]=b; }
    return {};
}""",
    "runningMedianScores": """vector<long long> runningMedianScores(vector<long long> scores){
    vector<long long> sorted, out;
    for(long long score:scores){ sorted.insert(lower_bound(sorted.begin(), sorted.end(), score), score); out.push_back(sorted[(sorted.size()-1)/2]); }
    return out;
}""",
    "topPriorityAssignments": """vector<string> topPriorityAssignments(vector<string> names, vector<long long> priorities, long long k){
    vector<pair<long long,string>> items; for(size_t i=0;i<names.size();i++) items.push_back({-priorities[i], names[i]});
    sort(items.begin(), items.end()); vector<string> out; for(long long i=0;i<k && i<(long long)items.size();i++) out.push_back(items[i].second);
    return out;
}""",
    "treeRightSideView": """vector<long long> treeRightSideView(vector<long long> tree){
    vector<long long> out; size_t index=0, width=1;
    while(index<tree.size()){ bool any=false; long long last=0; for(size_t i=0;i<width && index<tree.size();i++,index++){ if(tree[index]!=-1){ any=true; last=tree[index]; } } if(any) out.push_back(last); width*=2; }
    return out;
}""",
    "countSetBits": """long long countSetBits(long long n){
    long long count=0; while(n>0){ count += n & 1LL; n >>= 1; } return count;
}""",
    "isPowerOfTwo": """bool isPowerOfTwo(long long n){
    return n > 0 && (n & (n - 1)) == 0;
}""",
    "prefixBalanceIndex": """long long prefixBalanceIndex(vector<long long> nums){
    long long total=0; for(long long value:nums) total += value; long long left=0;
    for(long long i=0;i<(long long)nums.size();i++){ if(left == total - left - nums[i]) return i; left += nums[i]; }
    return -1;
}""",
    "matrixDiagonalSum": """long long matrixDiagonalSum(vector<vector<long long>> matrix){
    long long n=matrix.size(), sum=0; for(long long i=0;i<n;i++){ sum += matrix[i][i]; long long other=n-1-i; if(other!=i) sum += matrix[i][other]; } return sum;
}""",
    "differentBitCount": """long long differentBitCount(long long a, long long b){
    long long x=a^b, count=0; while(x>0){ count += x & 1LL; x >>= 1; } return count;
}""",
    "matrixBorderSum": """long long matrixBorderSum(vector<vector<long long>> matrix){
    if(matrix.empty() || matrix[0].empty()) return 0; long long rows=matrix.size(), cols=matrix[0].size(), sum=0;
    for(long long r=0;r<rows;r++) for(long long c=0;c<cols;c++) if(r==0 || c==0 || r==rows-1 || c==cols-1) sum += matrix[r][c];
    return sum;
}""",
    "longestSubarraySumK": """long long longestSubarraySumK(vector<long long> nums, long long k){
    map<long long,long long> first; first[0] = -1; long long sum=0,best=0;
    for(long long i=0;i<(long long)nums.size();i++){ sum += nums[i]; if(first.count(sum-k)) best=max(best, i-first[sum-k]); if(!first.count(sum)) first[sum]=i; }
    return best;
}""",
    "maximumPairXor": """long long maximumPairXor(vector<long long> nums){
    long long best=0; for(size_t i=0;i<nums.size();i++) for(size_t j=i+1;j<nums.size();j++) best=max(best, nums[i]^nums[j]); return best;
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
def test_cpp_beginner_starter_uses_int_vector_for_sum_even_numbers():
    starter = build_starter_from_spec("cpp", "sumEvenNumbers")

    assert starter is not None
    assert "#include <vector>" in starter
    assert "#include <bits/stdc++.h>" not in starter
    assert "int sumEvenNumbers(const std::vector<int>& nums)" in starter
    assert "long long" not in starter


def test_cpp_native_bridge_does_not_forward_declare_wider_signature():
    bridge = cpp_native_bridge("sumEvenNumbers", get_arg_spec("sumEvenNumbers"))

    assert "long long sumEvenNumbers(std::vector<long long> nums);" not in bridge
    assert "__call_sumEvenNumbers" in bridge


def test_cpp_beginner_adapter_ignores_local_int_vectors():
    code = """
long long editDistance(string source, string target) {
    vector<vector<int>> dp(source.size() + 1, vector<int>(target.size() + 1, 0));
    return dp[0][0];
}
"""
    spec = get_arg_spec("editDistance")
    adapter = _cpp_beginner_compat_adapter(code, "editDistance", spec, cpp_native_signature("editDistance", spec))

    assert adapter == ""


def test_all_cpp_beginner_vector_starters_get_hidden_grader_adapters():
    missing = []
    data = json.loads(_ANSWERS.read_text(encoding="utf-8"))

    for item in data.get("items", []):
        function_name = item.get("function_name")
        spec = get_arg_spec(function_name)
        if not function_name or not spec:
            continue
        starter = build_starter_from_spec("cpp", function_name) or ""
        if "std::vector<int>" not in starter and "std::vector<std::vector<int>>" not in starter:
            continue

        expected_signature = cpp_native_signature(function_name, spec)
        adapter = _cpp_beginner_compat_adapter(starter, function_name, spec, expected_signature)
        if expected_signature not in adapter:
            missing.append(f"{function_name}: missing adapter for generated starter")

        snake_name = _camel_to_snake_name(function_name)
        if snake_name != function_name:
            snake_starter = starter.replace(function_name, snake_name, 1)
            snake_adapter = _cpp_beginner_compat_adapter(snake_starter, function_name, spec, expected_signature)
            if expected_signature not in snake_adapter or snake_name not in snake_adapter:
                missing.append(f"{function_name}: missing adapter for snake_case starter")

    assert missing == []


@pytest.mark.skipif(not _HAS_GPP, reason="no C++ compiler on PATH")
def test_cpp_runner_accepts_beginner_const_vector_int_signature():
    spec = get_arg_spec("sumEvenNumbers")
    tests = _TESTS["sumEvenNumbers"]
    code = """#include <vector>

int sumEvenNumbers(const std::vector<int>& nums) {
    int current_sum = 0;
    for (int num : nums) {
        if (num % 2 == 0) {
            current_sum += num;
        }
    }
    return current_sum;
}
"""

    result = run_cpp_practice_tests(code, "sumEvenNumbers", tests, arg_spec=spec)

    assert result["status"] == "passed", result.get("stderr")


@pytest.mark.skipif(not _HAS_GPP, reason="no C++ compiler on PATH")
def test_cpp_tree_height_accepts_beginner_const_vector_int_signature():
    spec = get_arg_spec("treeHeightLevels")
    tests = _TESTS["treeHeightLevels"]
    code = """#include <string>
#include <vector>
#include <cmath>
#include <set>

int treeHeightLevels(const std::vector<int>& tree) {
    if (tree.empty()) {
        return 0;
    }

    std::set<int> active_levels;
    for (int i = 0; i < tree.size(); ++i) {
        int node_value = tree[i];
        if (node_value != -1) {
            int current_level = static_cast<int>(std::floor(std::log2(i + 1)));
            active_levels.insert(current_level);
        }
    }

    return active_levels.size();
}
"""

    result = run_cpp_practice_tests(code, "treeHeightLevels", tests, arg_spec=spec)

    assert result["status"] == "passed", result


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
    # COSC 101-style beginner shapes
    "parkingTicketTotal": "class Solution { static int parkingTicketTotal(String day, int hour, int minutesParked, boolean hasPermit){ if(day.equals(\"Saturday\") || day.equals(\"Sunday\")) return 0; if(hour<7 || hour>=19) return 0; if(day.equals(\"Wednesday\") && (hour==12 || hour==13)) return 0; int total=20; if(minutesParked>120) total+=10; if(!hasPermit && hour>=9 && hour<=16 && !(day.equals(\"Friday\") && hour>=15)) total+=15; return total; } }",
    "plantWateringMessage": "class Solution { static String plantWateringMessage(int moisture, boolean isSunny){ return (moisture<30 || (isSunny && moisture<45)) ? \"water today\" : \"check tomorrow\"; } }",
    "temperatureComfortCount": "class Solution { static int temperatureComfortCount(int[] readings, int low, int high){ int c=0; for(int r:readings) if(r>=low && r<=high) c++; return c; } }",
    "groceryPriceLookup": "class Solution { static int groceryPriceLookup(String[] items, int[] prices, String target){ for(int i=0;i<items.length;i++) if(items[i].equals(target)) return prices[i]; return -1; } }",
    "courseCreditTotal": "import java.util.*; class Solution { static int courseCreditTotal(String[] courses, int[] credits, String[] selectedCourses){ Map<String,Integer> m=new HashMap<>(); for(int i=0;i<courses.length;i++) m.put(courses[i], credits[i]); int total=0; for(String c:selectedCourses) total += m.getOrDefault(c, 0); return total; } }",
    "favoriteCourseCounts": "import java.util.*; class Solution { static int[] favoriteCourseCounts(String[] favorites, String[] targets){ Map<String,Integer> m=new HashMap<>(); for(String f:favorites) m.put(f, m.getOrDefault(f,0)+1); int[] out=new int[targets.length]; for(int i=0;i<targets.length;i++) out[i]=m.getOrDefault(targets[i],0); return out; } }",
    "uniqueParkingZones": "import java.util.*; class Solution { static int uniqueParkingZones(String[] zones){ return new HashSet<>(Arrays.asList(zones)).size(); } }",
    "sharedStudyTopics": "import java.util.*; class Solution { static String[] sharedStudyTopics(String[] firstTopics, String[] secondTopics){ Set<String> second=new HashSet<>(Arrays.asList(secondTopics)); Set<String> used=new HashSet<>(); List<String> out=new ArrayList<>(); for(String t:firstTopics) if(second.contains(t) && used.add(t)) out.add(t); return out.toArray(new String[0]); } }",
    "pairNamesWithScores": "class Solution { static String[] pairNamesWithScores(String[] names, int[] scores){ String[] out=new String[names.length]; for(int i=0;i<names.length;i++) out[i]=names[i]+\":\"+scores[i]; return out; } }",
    "swapPairOrder": "class Solution { static String[] swapPairOrder(String[] pairItems){ if(pairItems.length<2) return pairItems.clone(); return new String[]{pairItems[1], pairItems[0]}; } }",
    "lateAssignmentPenalty": "class Solution { static int lateAssignmentPenalty(int score, int daysLate){ return Math.max(0, score - daysLate * 5); } }",
    "weeklyPlantCareDays": "import java.util.*; class Solution { static String[] weeklyPlantCareDays(int[] moistureReadings, int threshold){ String[] days={\"Mon\",\"Tue\",\"Wed\",\"Thu\",\"Fri\",\"Sat\",\"Sun\"}; List<String> out=new ArrayList<>(); for(int i=0;i<moistureReadings.length && i<days.length;i++) if(moistureReadings[i]<threshold) out.add(days[i]); return out.toArray(new String[0]); } }",
    "edgePairMatches": "class Solution { static int edgePairMatches(String[] words){ int count=0,left=0,right=words.length-1; while(left<right){ if(words[left].equals(words[right])) count++; left++; right--; } return count; } }",
    "countShortStudyBlocks": "class Solution { static int countShortStudyBlocks(int[] minutes, int limit){ int count=0; for(int i=1;i<minutes.length;i++) if(minutes[i-1]+minutes[i]<=limit) count++; return count; } }",
    "recursiveFactorialSmall": "class Solution { static int recursiveFactorialSmall(int n){ if(n<=1) return 1; return n * recursiveFactorialSmall(n-1); } }",
    "reverseOnlyLetters": "class Solution { static String reverseOnlyLetters(String text){ char[] chars=text.toCharArray(); int left=0,right=chars.length-1; while(left<right){ while(left<right && !Character.isLetter(chars[left])) left++; while(left<right && !Character.isLetter(chars[right])) right--; if(left<right){ char temp=chars[left]; chars[left++]=chars[right]; chars[right--]=temp; } } return new String(chars); } }",
    "minimumStudyWindow": "class Solution { static int minimumStudyWindow(int[] minutes, int target){ int best=Integer.MAX_VALUE,sum=0,left=0; for(int right=0;right<minutes.length;right++){ sum+=minutes[right]; while(sum>=target){ best=Math.min(best,right-left+1); sum-=minutes[left++]; } } return best==Integer.MAX_VALUE ? 0 : best; } }",
    "recursivePower": "class Solution { static int recursivePower(int base, int exponent){ if(exponent==0) return 1; return base * recursivePower(base, exponent-1); } }",
    "stackTopAfterPlates": "import java.util.*; class Solution { static String stackTopAfterPlates(String[] commands){ List<String> st=new ArrayList<>(); for(String cmd:commands){ if(cmd.startsWith(\"push \")) st.add(cmd.substring(5)); else if(cmd.equals(\"pop\") && !st.isEmpty()) st.remove(st.size()-1); } return st.isEmpty()?\"none\":st.get(st.size()-1); } }",
    "queueFrontAfterServes": "class Solution { static String queueFrontAfterServes(String[] names, int serveCount){ return serveCount>=names.length ? \"none\" : names[serveCount]; } }",
    "firstOneIndex": "class Solution { static int firstOneIndex(int[] flags){ int left=0,right=flags.length-1,ans=-1; while(left<=right){ int mid=left+(right-left)/2; if(flags[mid]==1){ ans=mid; right=mid-1; } else left=mid+1; } return ans; } }",
    "treeNodeCount": "class Solution { static int treeNodeCount(int[] tree){ int count=0; for(int value:tree) if(value!=-1) count++; return count; } }",
    "treeHeightLevels": "class Solution { static int treeHeightLevels(int[] tree){ int height=0; for(int i=0;i<tree.length;i++){ if(tree[i]==-1) continue; int level=0,pos=i+1; while(pos>0){ level++; pos/=2; } height=Math.max(height,level); } return height; } }",
    "linkedListLength": "class Solution { static int linkedListLength(int[] nextIndexes, int head){ int count=0,cur=head; while(cur!=-1){ count++; cur=nextIndexes[cur]; } return count; } }",
    "treeLeafCount": "class Solution { static int treeLeafCount(int[] tree){ int count=0; for(int i=0;i<tree.length;i++){ if(tree[i]==-1) continue; int l=2*i+1,r=2*i+2; boolean left=l<tree.length && tree[l]!=-1, right=r<tree.length && tree[r]!=-1; if(!left && !right) count++; } return count; } }",
    "treeContainsValue": "class Solution { static boolean treeContainsValue(int[] tree, int target){ for(int value:tree) if(value!=-1 && value==target) return true; return false; } }",
    "linkedListMergeIndex": "import java.util.*; class Solution { static int linkedListMergeIndex(int[] nextIndexes, int headA, int headB){ Set<Integer> seen=new HashSet<>(); for(int cur=headA; cur!=-1; cur=nextIndexes[cur]) seen.add(cur); for(int cur=headB; cur!=-1; cur=nextIndexes[cur]) if(seen.contains(cur)) return cur; return -1; } }",
    "campusStopReachable": "import java.util.*; class Solution { static boolean campusStopReachable(String[][] connections, String start, String target){ if(start.equals(target)) return true; Map<String,List<String>> g=new HashMap<>(); for(String[] e:connections) g.computeIfAbsent(e[0],k->new ArrayList<>()).add(e[1]); Queue<String> q=new ArrayDeque<>(); Set<String> seen=new HashSet<>(); q.add(start); seen.add(start); while(!q.isEmpty()){ String cur=q.poll(); for(String next:g.getOrDefault(cur, Collections.emptyList())){ if(next.equals(target)) return true; if(seen.add(next)) q.add(next); } } return false; } }",
    "clubMembershipGroups": "import java.util.*; class Solution { static int[] par; static int find(int x){ while(par[x]!=x){ par[x]=par[par[x]]; x=par[x]; } return x; } static int clubMembershipGroups(int n, int[][] pairs){ par=new int[n]; for(int i=0;i<n;i++) par[i]=i; for(int[] p:pairs) par[find(p[0])]=find(p[1]); Set<Integer> s=new HashSet<>(); for(int i=0;i<n;i++) s.add(find(i)); return s.size(); } }",
    "minStudyPlanCost": "class Solution { static int minStudyPlanCost(int[] costs){ if(costs.length==0) return 0; if(costs.length==1) return costs[0]; int prev2=costs[0], prev1=costs[1]; for(int i=2;i<costs.length;i++){ int cur=Math.min(prev1,prev2)+costs[i]; prev2=prev1; prev1=cur; } return Math.min(prev1,prev2); } }",
    "prefixMatchCount": "class Solution { static int prefixMatchCount(String[] words, String prefix){ int count=0; for(String word:words) if(word.startsWith(prefix)) count++; return count; } }",
    "redundantFriendshipEdge": "class Solution { static int[] par; static int find(int x){ while(par[x]!=x){ par[x]=par[par[x]]; x=par[x]; } return x; } static int[] redundantFriendshipEdge(int n, int[][] pairs){ par=new int[n]; for(int i=0;i<n;i++) par[i]=i; for(int[] p:pairs){ int a=find(p[0]), b=find(p[1]); if(a==b) return new int[]{p[0],p[1]}; par[a]=b; } return new int[0]; } }",
    "runningMedianScores": "import java.util.*; class Solution { static int[] runningMedianScores(int[] scores){ List<Integer> sorted=new ArrayList<>(); int[] out=new int[scores.length]; for(int i=0;i<scores.length;i++){ int pos=Collections.binarySearch(sorted, scores[i]); if(pos<0) pos=-pos-1; sorted.add(pos, scores[i]); out[i]=sorted.get((sorted.size()-1)/2); } return out; } }",
    "topPriorityAssignments": "import java.util.*; class Solution { static String[] topPriorityAssignments(String[] names, int[] priorities, int k){ List<int[]> idx=new ArrayList<>(); for(int i=0;i<names.length;i++) idx.add(new int[]{i}); idx.sort((a,b) -> priorities[b[0]]!=priorities[a[0]] ? priorities[b[0]]-priorities[a[0]] : names[a[0]].compareTo(names[b[0]])); String[] out=new String[Math.min(k, idx.size())]; for(int i=0;i<out.length;i++) out[i]=names[idx.get(i)[0]]; return out; } }",
    "treeRightSideView": "import java.util.*; class Solution { static int[] treeRightSideView(int[] tree){ List<Integer> out=new ArrayList<>(); int index=0, width=1; while(index<tree.length){ boolean any=false; int last=0; for(int i=0;i<width && index<tree.length;i++,index++){ if(tree[index]!=-1){ any=true; last=tree[index]; } } if(any) out.add(last); width*=2; } return out.stream().mapToInt(Integer::intValue).toArray(); } }",
    "countSetBits": "class Solution { static int countSetBits(int n){ int count=0; while(n>0){ count += n & 1; n >>= 1; } return count; } }",
    "isPowerOfTwo": "class Solution { static boolean isPowerOfTwo(int n){ return n > 0 && (n & (n - 1)) == 0; } }",
    "prefixBalanceIndex": "class Solution { static int prefixBalanceIndex(int[] nums){ int total=0; for(int value:nums) total+=value; int left=0; for(int i=0;i<nums.length;i++){ if(left == total - left - nums[i]) return i; left += nums[i]; } return -1; } }",
    "matrixDiagonalSum": "class Solution { static int matrixDiagonalSum(int[][] matrix){ int n=matrix.length,sum=0; for(int i=0;i<n;i++){ sum += matrix[i][i]; int other=n-1-i; if(other!=i) sum += matrix[i][other]; } return sum; } }",
    "differentBitCount": "class Solution { static int differentBitCount(int a, int b){ int x=a^b,count=0; while(x>0){ count += x & 1; x >>= 1; } return count; } }",
    "matrixBorderSum": "class Solution { static int matrixBorderSum(int[][] matrix){ if(matrix.length==0 || matrix[0].length==0) return 0; int rows=matrix.length, cols=matrix[0].length, sum=0; for(int r=0;r<rows;r++) for(int c=0;c<cols;c++) if(r==0 || c==0 || r==rows-1 || c==cols-1) sum += matrix[r][c]; return sum; } }",
    "longestSubarraySumK": "import java.util.*; class Solution { static int longestSubarraySumK(int[] nums, int k){ Map<Integer,Integer> first=new HashMap<>(); first.put(0,-1); int sum=0,best=0; for(int i=0;i<nums.length;i++){ sum += nums[i]; if(first.containsKey(sum-k)) best=Math.max(best, i-first.get(sum-k)); first.putIfAbsent(sum,i); } return best; } }",
    "maximumPairXor": "class Solution { static int maximumPairXor(int[] nums){ int best=0; for(int i=0;i<nums.length;i++) for(int j=i+1;j<nums.length;j++) best=Math.max(best, nums[i]^nums[j]); return best; } }",
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
